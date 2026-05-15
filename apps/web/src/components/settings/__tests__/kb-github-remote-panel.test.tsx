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

  it('submits the GitHub App manifest with setup state', async () => {
    const submitMock = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(notConfiguredIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote/setup-state' && init?.method === 'POST') {
        return jsonResponse({ state: 'state-1' })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    renderPanel(notConfiguredIntegration)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect GitHub' }))

    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    const submittedForm = submitMock.mock.contexts[0] as HTMLFormElement
    const input = submittedForm.querySelector('input[name="manifest"]') as HTMLInputElement | null
    expect(submittedForm.action).toBe('https://github.com/settings/apps/new?state=state-1')
    expect(input?.type).toBe('hidden')
    expect(JSON.parse(input?.value ?? '{}')).toMatchObject({
      default_permissions: { contents: 'write', metadata: 'read' },
      name: 'Arche KB Sync',
      public: false,
    })
    expect(input?.value).toContain('/api/u/alice/kb-github-remote/callback?state=state-1')
    submitMock.mockRestore()
  })

  it('shows setup-state errors while connecting GitHub', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/kb-github-remote') {
        return jsonResponse(notConfiguredIntegration)
      }
      if (url === '/api/u/alice/kb-github-remote/setup-state' && init?.method === 'POST') {
        return jsonResponse({ error: 'unauthorized' }, { status: 401 })
      }
      return jsonResponse({ error: `unexpected fetch: ${url}` }, { status: 500 })
    })

    renderPanel(notConfiguredIntegration)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect GitHub' }))

    expect(await screen.findByText('Sign in again before continuing.')).toBeTruthy()
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
