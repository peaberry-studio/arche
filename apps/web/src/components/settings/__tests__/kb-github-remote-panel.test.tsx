/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KbGithubRemotePanel } from '@/components/settings/kb-github-remote-panel'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'

const ensureInstanceRunningActionMock = vi.fn()
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

vi.mock('@/actions/spawner', () => ({
  ensureInstanceRunningAction: (...args: unknown[]) => ensureInstanceRunningActionMock(...args),
}))

const readyIntegration: KbGithubRemoteIntegrationSummary = {
  appConfigured: true,
  appId: '42',
  appSlug: 'arche-kb-sync',
  hasPrivateKey: true,
  installationAccount: 'acme',
  installationId: 123,
  lastError: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  ready: true,
  repoDefaultBranch: 'main',
  repoFullName: 'acme/kb',
  updatedAt: null,
  version: 1,
}

const notConfiguredIntegration: KbGithubRemoteIntegrationSummary = {
  appConfigured: false,
  appId: null,
  appSlug: null,
  hasPrivateKey: false,
  installationAccount: null,
  installationId: null,
  lastError: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  ready: false,
  repoDefaultBranch: null,
  repoFullName: null,
  updatedAt: null,
  version: 1,
}

const installedIntegration: KbGithubRemoteIntegrationSummary = {
  ...readyIntegration,
  ready: false,
  repoDefaultBranch: null,
  repoFullName: null,
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function renderPanel(
  initialIntegration: KbGithubRemoteIntegrationSummary = readyIntegration,
  props?: { initialError?: string | null },
) {
  return render(
    <KbGithubRemotePanel
      initialError={props?.initialError}
      initialIntegration={initialIntegration}
      slug="alice"
    />,
  )
}

describe('KbGithubRemotePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    ensureInstanceRunningActionMock.mockReset()
    ensureInstanceRunningActionMock.mockResolvedValue({ status: 'running' })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/instances/alice/publish-kb' && init?.method === 'POST') {
        return jsonResponse({ status: 'published' })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('starts the workspace before publishing an initial sync', async () => {
    renderPanel()

    expect(await screen.findByText('acme/kb')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }))

    await waitFor(() => expect(ensureInstanceRunningActionMock).toHaveBeenCalledWith('alice'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/instances/alice/publish-kb', { method: 'POST' }))

    const publishCall = fetchMock.mock.calls.findIndex(([input]) => String(input) === '/api/instances/alice/publish-kb')
    expect(publishCall).toBeGreaterThanOrEqual(0)
    expect(ensureInstanceRunningActionMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[publishCall],
    )
    expect(await screen.findByText('Knowledge base synced to GitHub.')).toBeTruthy()
  })

  it('navigates to the server-side manifest endpoint', async () => {
    const hrefSetter = vi.fn()
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!
    const locationMock = { ...window.location }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    })
    Object.defineProperty(locationMock, 'href', { set: hrefSetter, configurable: true })

    renderPanel(notConfiguredIntegration)
    expect((await screen.findByRole('radio', { name: /signed-in user/i }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect GitHub' }))

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/api/u/alice/kb-github-remote/manifest'))

    Object.defineProperty(window, 'location', originalDescriptor)
  })

  it('navigates to the manifest endpoint with an organization owner', async () => {
    const hrefSetter = vi.fn()
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!
    const locationMock = { ...window.location }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    })
    Object.defineProperty(locationMock, 'href', { set: hrefSetter, configurable: true })

    renderPanel(notConfiguredIntegration)
    fireEvent.click(await screen.findByRole('radio', { name: /organization/i }))
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'acme-org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/api/u/alice/kb-github-remote/manifest?owner=acme-org'))

    Object.defineProperty(window, 'location', originalDescriptor)
  })

  it('validates the organization name before navigating', async () => {
    renderPanel(notConfiguredIntegration)
    fireEvent.click(await screen.findByRole('radio', { name: /organization/i }))
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: '../acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(await screen.findByText('Enter a valid GitHub organization name before creating the app.')).toBeTruthy()
  })

  it('loads and selects repositories after installation', async () => {
    let integration = installedIntegration
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(integration)
      }
      if (url === '/api/u/alice/kb-github-remote/repos' && init?.method === 'PUT') {
        integration = { ...readyIntegration, repoFullName: 'acme/new-kb' }
        return jsonResponse({ ok: true, repoFullName: 'acme/new-kb' })
      }
      if (url === '/api/u/alice/kb-github-remote/repos') {
        return jsonResponse({ repos: [{ defaultBranch: 'main', fullName: 'acme/new-kb', private: false }] })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    renderPanel(installedIntegration)

    expect(await screen.findByText('Select repository')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /acme\/new-kb/ }))

    expect(await screen.findByText('Repository acme/new-kb selected. Run the initial sync to publish local KB content.')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/u/alice/kb-github-remote/repos',
      expect.objectContaining({ body: JSON.stringify({ repoFullName: 'acme/new-kb' }), method: 'PUT' }),
    ))
  })

  it('shows when no repositories are available', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(installedIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote/repos') {
        return jsonResponse({ repos: [] })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    renderPanel(installedIntegration)

    expect(await screen.findByText('No repositories are available to this GitHub App installation.')).toBeTruthy()
  })

  it('tests and disconnects a ready integration', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote' && init?.method === 'DELETE') {
        return jsonResponse(notConfiguredIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote/test' && init?.method === 'POST') {
        return jsonResponse({ ok: true, message: 'Token ok.' })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Token ok.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText('GitHub KB sync disconnected.')).toBeTruthy()
  })

  it('surfaces workspace start errors before initial sync', async () => {
    ensureInstanceRunningActionMock.mockResolvedValue({ error: 'setup_required', status: 'error' })

    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Sync now/ }))

    expect(await screen.findByText('Finish Kickstart setup before syncing the knowledge base.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/instances/alice/publish-kb', { method: 'POST' })
  })

  it('shows install-return success from URL params and clears them', async () => {
    window.history.pushState({}, '', '/u/alice/settings/integrations/kb-github-remote?installed=true')

    renderPanel()

    expect(await screen.findByText('GitHub App installed. Select a repository to finish setup.')).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('shows initial integration errors', async () => {
    renderPanel(notConfiguredIntegration, { initialError: 'forbidden' })

    expect(await screen.findByText('Only admins can manage GitHub KB sync.')).toBeTruthy()
  })

  it('shows the install-app state when app is created but not installed', async () => {
    const appOnlyIntegration: KbGithubRemoteIntegrationSummary = {
      ...notConfiguredIntegration,
      appConfigured: true,
      appId: '42',
      appSlug: 'arche-kb-sync',
      hasPrivateKey: true,
    }
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/u/alice/kb-github-remote') {
        return jsonResponse(appOnlyIntegration)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel(appOnlyIntegration)

    const installLink = screen.getByRole('link', { name: 'Install on GitHub' }) as HTMLAnchorElement
    expect(installLink.href).toMatch(/\/api\/u\/alice\/kb-github-remote\/install$/)
  })

  it('shows last sync time and last error for a ready integration', async () => {
    const integrationWithHistory: KbGithubRemoteIntegrationSummary = {
      ...readyIntegration,
      lastSyncAt: new Date('2026-05-15T12:00:00.000Z').toISOString(),
      lastError: 'Previous sync failed.',
    }
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/u/alice/kb-github-remote') {
        return jsonResponse(integrationWithHistory)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel(integrationWithHistory)

    expect(await screen.findByText(/Last sync:/)).toBeTruthy()
    expect(screen.getByText('Previous sync failed.')).toBeTruthy()
  })

  it('shows repo repicker when clicking Change repo', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote/repos') {
        return jsonResponse({ repos: [{ defaultBranch: 'main', fullName: 'acme/other', private: false }] })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Change repo' }))
    expect(await screen.findByText('acme/other')).toBeTruthy()
  })

  it('shows error when disconnect fails', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote' && init?.method === 'DELETE') {
        throw new Error('Network failure')
      }
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
  })

  it('shows error when test connection fails', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote/test' && init?.method === 'POST') {
        return jsonResponse({ ok: false, message: 'Credentials rejected.' })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Credentials rejected.')).toBeTruthy()
  })

  it('shows error when disconnect returns a non-ok response', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote' && init?.method === 'DELETE') {
        return jsonResponse({ error: 'not_configured' }, { status: 400 })
      }
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText('Create the GitHub App before continuing.')).toBeTruthy()
  })

  it('shows error when selecting a repo fails', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote/repos' && init?.method === 'PUT') {
        return jsonResponse({ error: 'invalid_body' }, { status: 400 })
      }
      if (url === '/api/u/alice/kb-github-remote/repos') {
        return jsonResponse({ repos: [{ defaultBranch: 'main', fullName: 'acme/other', private: false }] })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Change repo' }))
    fireEvent.click(await screen.findByRole('button', { name: /acme\/other/ }))
    expect(await screen.findByText('The request body was invalid.')).toBeTruthy()
  })

  it('shows network error when load repos fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote/repos') {
        throw new Error('Network failure')
      }
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Change repo' }))
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
  })

  it('shows network error when test connection fetch throws', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote/test' && init?.method === 'POST') {
        throw new Error('Network failure')
      }
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
  })

  it('shows network error when publish-kb fetch throws', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/instances/alice/publish-kb' && init?.method === 'POST') {
        throw new Error('Network failure')
      }
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Sync now/ }))
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
  })

  it('shows start_timeout when publish-kb returns 409', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/instances/alice/publish-kb' && init?.method === 'POST') {
        return jsonResponse({ error: 'start_timeout' }, { status: 409 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Sync now/ }))
    expect(await screen.findByText('The workspace is still starting. Try syncing again in a moment.')).toBeTruthy()
  })

  it('shows error when publish-kb returns a non-ok response', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/instances/alice/publish-kb' && init?.method === 'POST') {
        return jsonResponse({ error: 'status_check_failed' }, { status: 500 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Sync now/ }))
    expect(await screen.findByText('Could not start the workspace for sync.')).toBeTruthy()
  })

  it('shows initial sync conflict and error results', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/instances/alice/publish-kb' && init?.method === 'POST') {
        return jsonResponse({ ok: true, status: 'conflicts' })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    const { unmount } = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Sync now/ }))
    expect(await screen.findByText('Sync found conflicts. Open the Knowledge Review panel to resolve them.')).toBeTruthy()
    unmount()

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(readyIntegration)
      }
      if (url === '/api/instances/alice/publish-kb' && init?.method === 'POST') {
        return jsonResponse({ ok: false, message: 'Push rejected.', status: 'push_rejected' })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Sync now/ }))
    expect(await screen.findByText('Push rejected.')).toBeTruthy()
  })
})
