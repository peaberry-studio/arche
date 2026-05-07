/** @vitest-environment jsdom */

import type { ReactNode } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  KbGithubRemoteIntegrationSummary,
  KbGithubRemoteRepo,
} from '@/lib/kb-github-remote/types'

vi.mock('@phosphor-icons/react', () => ({
  ArrowsClockwise: ({ size, className }: { size?: number; className?: string }) => (
    <span data-testid="arrows-clockwise" data-size={size} className={className} />
  ),
  SpinnerGap: ({ size, className }: { size?: number; className?: string }) => (
    <span data-testid="spinner-gap" data-size={size} className={className} />
  ),
}))

vi.mock('@/components/settings/settings-info-box', () => ({
  SettingsInfoBox: ({ tone, children }: { tone: string; children: ReactNode }) => (
    <div data-testid={`info-box-${tone}`}>{children}</div>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className }: { children: ReactNode; variant?: string; className?: string }) => (
    <span data-testid="badge" data-variant={variant} className={className}>{children}</span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    type: _type,
    size,
    asChild,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    variant?: string
    type?: string
    size?: string
    asChild?: boolean
  }) => {
    if (asChild) return <>{children}</>
    return (
      <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size}>
        {children}
      </button>
    )
  },
}))

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const baseSummary: KbGithubRemoteIntegrationSummary = {
  appId: null,
  appSlug: null,
  appConfigured: false,
  hasPrivateKey: false,
  installationId: null,
  repoFullName: null,
  ready: false,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastError: null,
  remoteBranch: null,
  version: 0,
  updatedAt: null,
}

const configuredSummary: KbGithubRemoteIntegrationSummary = {
  ...baseSummary,
  appId: '12345',
  appSlug: 'arche-kb-sync',
  appConfigured: true,
  hasPrivateKey: true,
}

const installedSummary: KbGithubRemoteIntegrationSummary = {
  ...configuredSummary,
  installationId: 99,
}

const readySummary: KbGithubRemoteIntegrationSummary = {
  ...installedSummary,
  repoFullName: 'owner/repo',
  ready: true,
}

const repos: KbGithubRemoteRepo[] = [
  { fullName: 'owner/repo1', cloneUrl: 'https://github.com/owner/repo1.git', private: false },
  { fullName: 'owner/repo2', cloneUrl: 'https://github.com/owner/repo2.git', private: true },
]

describe('KbGithubRemotePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()

    vi.stubGlobal('location', {
      origin: 'https://arche.test',
      search: '',
      pathname: '/u/alice/settings/integrations/kb-github-remote',
      href: 'https://arche.test/u/alice/settings/integrations/kb-github-remote',
    })
    vi.stubGlobal('history', { replaceState: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function renderPanel() {
    const { KbGithubRemotePanel } = await import('../kb-github-remote-panel')
    return render(<KbGithubRemotePanel slug="alice" />)
  }

  describe('initial load', () => {
    it('shows loading indicator then renders connect button', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(baseSummary))

      await renderPanel()

      expect(screen.getByText('Loading…')).toBeTruthy()
      await waitFor(() => expect(screen.getByText('Connect to GitHub')).toBeTruthy())
    })

    it('handles load error from non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('Only admins can manage the GitHub KB Backup integration.')).toBeTruthy(),
      )
    })

    it('handles network error on load', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('Could not reach the server.')).toBeTruthy(),
      )
    })

    it('handles null response body', async () => {
      fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByTestId('info-box-error')).toBeTruthy(),
      )
    })
  })

  describe('URL query params', () => {
    it('shows success when app_created=true', async () => {
      vi.stubGlobal('location', {
        origin: 'https://arche.test',
        search: '?app_created=true',
        pathname: '/u/alice/settings/integrations/kb-github-remote',
        href: 'https://arche.test/u/alice/settings/integrations/kb-github-remote?app_created=true',
      })
      fetchMock.mockResolvedValueOnce(jsonResponse(configuredSummary))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('GitHub App created successfully. Now install it on your account.')).toBeTruthy(),
      )
      expect(window.history.replaceState).toHaveBeenCalled()
    })

    it('shows success when installed=true', async () => {
      vi.stubGlobal('location', {
        origin: 'https://arche.test',
        search: '?installed=true',
        pathname: '/u/alice/settings/integrations/kb-github-remote',
        href: 'https://arche.test/u/alice/settings/integrations/kb-github-remote?installed=true',
      })
      fetchMock.mockResolvedValueOnce(jsonResponse(installedSummary))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('GitHub App installed. Select a repository to complete setup.')).toBeTruthy(),
      )
    })

    it('shows error when error param present', async () => {
      vi.stubGlobal('location', {
        origin: 'https://arche.test',
        search: '?error=exchange_failed',
        pathname: '/u/alice/settings/integrations/kb-github-remote',
        href: 'https://arche.test/u/alice/settings/integrations/kb-github-remote?error=exchange_failed',
      })
      fetchMock.mockResolvedValueOnce(jsonResponse(baseSummary))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText(/Failed to create the GitHub App/)).toBeTruthy(),
      )
    })

    it('shows unknown error verbatim for unmapped code', async () => {
      vi.stubGlobal('location', {
        origin: 'https://arche.test',
        search: '?error=some_unknown_error',
        pathname: '/u/alice/settings/integrations/kb-github-remote',
        href: 'https://arche.test/u/alice/settings/integrations/kb-github-remote?error=some_unknown_error',
      })
      fetchMock.mockResolvedValueOnce(jsonResponse(baseSummary))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('some_unknown_error')).toBeTruthy(),
      )
    })
  })

  describe('connect flow', () => {
    it('creates and submits a form to GitHub', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(baseSummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Connect to GitHub')).toBeTruthy())

      const submitMock = vi.fn()
      const removeMock = vi.fn()
      const originalCreateElement = document.createElement.bind(document)

      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag)
        if (tag === 'form') {
          el.submit = submitMock
          el.remove = removeMock
        }
        return el
      })
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)

      fireEvent.click(screen.getByText('Connect to GitHub'))

      expect(submitMock).toHaveBeenCalled()
      expect(removeMock).toHaveBeenCalled()

      vi.restoreAllMocks()
    })
  })

  describe('install flow', () => {
    it('shows install button when app is configured but not installed', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(configuredSummary))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('Install on GitHub')).toBeTruthy())
      expect(screen.getByText('App created')).toBeTruthy()
    })

    it('shows disconnect button in install state', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(configuredSummary))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('Disconnect')).toBeTruthy())
    })
  })

  describe('disconnect', () => {
    it('calls DELETE and shows disconnected success', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(configuredSummary))
        .mockResolvedValueOnce(jsonResponse(baseSummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Disconnect')).toBeTruthy())

      fireEvent.click(screen.getByText('Disconnect'))

      await waitFor(() =>
        expect(screen.getByText('Disconnected from GitHub.')).toBeTruthy(),
      )
      expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'DELETE' }))
    })

    it('handles disconnect API error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(configuredSummary))
        .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Disconnect')).toBeTruthy())

      fireEvent.click(screen.getByText('Disconnect'))

      await waitFor(() =>
        expect(screen.getByText('Only admins can manage the GitHub KB Backup integration.')).toBeTruthy(),
      )
    })

    it('handles disconnect network error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(configuredSummary))
        .mockRejectedValueOnce(new Error('offline'))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Disconnect')).toBeTruthy())

      fireEvent.click(screen.getByText('Disconnect'))

      await waitFor(() =>
        expect(screen.getByText('Could not reach the server.')).toBeTruthy(),
      )
    })
  })

  describe('repo picker', () => {
    it('shows loading indicator and auto-loads repos when installed', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ repos }))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
      await waitFor(() => expect(screen.getByText('owner/repo1')).toBeTruthy())
    })

    it('auto-loads and displays repos', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ repos }))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('owner/repo1')).toBeTruthy())
      expect(screen.getByText('owner/repo2')).toBeTruthy()
      expect(screen.getByText('Public')).toBeTruthy()
      expect(screen.getByText('Private')).toBeTruthy()
    })

    it('auto-selects when only one repo is available', async () => {
      const singleRepo = [repos[0]]
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ repos: singleRepo }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('Repository "owner/repo1" selected.')).toBeTruthy(),
      )
    })

    it('shows empty state when no repos found', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ repos: [] }))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText(/No repositories found/)).toBeTruthy(),
      )
    })

    it('handles load repos error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ error: 'not_installed' }, { status: 400 }))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText(/not installed/)).toBeTruthy(),
      )
    })

    it('handles load repos network error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockRejectedValueOnce(new Error('offline'))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('Could not reach the server.')).toBeTruthy(),
      )
    })

    it('selects a repo and reloads integration', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ repos }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('owner/repo1')).toBeTruthy())

      fireEvent.click(screen.getByText('owner/repo1'))

      await waitFor(() =>
        expect(screen.getByText('Repository "owner/repo1" selected.')).toBeTruthy(),
      )
      const putCall = fetchMock.mock.calls[2]
      expect(putCall[1]).toEqual(expect.objectContaining({ method: 'PUT' }))
      expect(JSON.parse(String(putCall[1]?.body))).toEqual({
        repoFullName: 'owner/repo1',
      })
    })

    it('handles select repo error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ repos }))
        .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('owner/repo1')).toBeTruthy())

      fireEvent.click(screen.getByText('owner/repo1'))

      await waitFor(() =>
        expect(screen.getByText('Only admins can manage the GitHub KB Backup integration.')).toBeTruthy(),
      )
    })

    it('handles select repo network error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(installedSummary))
        .mockResolvedValueOnce(jsonResponse({ repos }))
        .mockRejectedValueOnce(new Error('offline'))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('owner/repo1')).toBeTruthy())

      fireEvent.click(screen.getByText('owner/repo1'))

      await waitFor(() =>
        expect(screen.getByText('Could not reach the server.')).toBeTruthy(),
      )
    })
  })

  describe('sync controls', () => {
    it('shows sync buttons when ready', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(readySummary))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())
      expect(screen.getByText('Pull from GitHub')).toBeTruthy()
      expect(screen.getByText('Test Connection')).toBeTruthy()
      expect(screen.getByText('owner/repo')).toBeTruthy()
    })

    it('shows last sync info when available', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        ...readySummary,
        lastSyncAt: '2026-05-01T10:00:00Z',
        lastSyncStatus: 'success',
        remoteBranch: 'main',
      }))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('Last sync successful')).toBeTruthy())
      expect(screen.getByText(/Last synced/)).toBeTruthy()
      expect(screen.getByText(/on branch main/)).toBeTruthy()
    })

    it('shows error badge and last error message', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        ...readySummary,
        lastSyncStatus: 'error',
        lastError: 'Authentication failed',
      }))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('Last sync failed')).toBeTruthy())
      expect(screen.getByText('Authentication failed')).toBeTruthy()
    })

    it('shows conflicts badge', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        ...readySummary,
        lastSyncStatus: 'conflicts',
      }))

      await renderPanel()

      await waitFor(() => expect(screen.getByText('Conflicts')).toBeTruthy())
    })
  })

  describe('push', () => {
    it('pushes successfully and shows success message', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'pushed' }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Push to GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Pushed successfully.')).toBeTruthy(),
      )
    })

    it('shows up to date message', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'up_to_date' }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Push to GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Already up to date.')).toBeTruthy(),
      )
    })

    it('shows push rejected error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: false, status: 'push_rejected' }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Push to GitHub'))

      await waitFor(() =>
        expect(screen.getByText(/Push rejected/)).toBeTruthy(),
      )
    })

    it('handles push API error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ error: 'not_ready' }, { status: 400 }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Push to GitHub'))

      await waitFor(() =>
        expect(screen.getByText(/No repository selected/)).toBeTruthy(),
      )
    })

    it('handles push network error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockRejectedValueOnce(new Error('offline'))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Push to GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Could not reach the server.')).toBeTruthy(),
      )
    })

    it('shows generic failure message when status unknown', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: false, status: 'error', message: 'Unexpected failure' }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Push to GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Unexpected failure')).toBeTruthy(),
      )
    })
  })

  describe('pull', () => {
    it('pulls successfully and shows success message', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'pulled' }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Pull from GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Pull from GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Pulled successfully.')).toBeTruthy(),
      )
    })

    it('shows conflicts with file list', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(
          jsonResponse({
            ok: false,
            status: 'conflicts',
            conflictingFiles: ['article1.md', 'article2.md'],
          }),
        )

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Pull from GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Pull from GitHub'))

      await waitFor(() =>
        expect(screen.getByText(/Merge conflicts detected in 2 file/)).toBeTruthy(),
      )
      expect(screen.getByText('Keep local version')).toBeTruthy()
      expect(screen.getByText('Keep GitHub version')).toBeTruthy()
    })

    it('handles pull network error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockRejectedValueOnce(new Error('offline'))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Pull from GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Pull from GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Could not reach the server.')).toBeTruthy(),
      )
    })

    it('shows generic pull failure', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: false, status: 'error' }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Pull from GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Pull from GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Pull failed.')).toBeTruthy(),
      )
    })

    it('shows resolved status on successful conflict resolution', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'resolved' }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Pull from GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Pull from GitHub'))

      await waitFor(() =>
        expect(screen.getByText('Conflicts resolved successfully.')).toBeTruthy(),
      )
    })
  })

  describe('conflict resolution', () => {
    async function renderWithConflicts() {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(
          jsonResponse({
            ok: false,
            status: 'conflicts',
            conflictingFiles: ['file1.md', 'file2.md'],
          }),
        )

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Pull from GitHub')).toBeTruthy())
      fireEvent.click(screen.getByText('Pull from GitHub'))
      await waitFor(() => expect(screen.getByText('Keep local version')).toBeTruthy())
    }

    it('resolves with local_wins strategy', async () => {
      await renderWithConflicts()

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'resolved' }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      fireEvent.click(screen.getByText('Keep local version'))

      await waitFor(() =>
        expect(screen.getByText('Conflicts resolved successfully.')).toBeTruthy(),
      )
      const resolveCall = fetchMock.mock.calls[2]
      expect(JSON.parse(String(resolveCall[1]?.body))).toEqual({
        direction: 'pull',
        strategy: 'local_wins',
      })
    })

    it('resolves with remote_wins strategy', async () => {
      await renderWithConflicts()

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'resolved' }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      fireEvent.click(screen.getByText('Keep GitHub version'))

      await waitFor(() =>
        expect(screen.getByText('Conflicts resolved successfully.')).toBeTruthy(),
      )
      const resolveCall = fetchMock.mock.calls[2]
      expect(JSON.parse(String(resolveCall[1]?.body))).toEqual({
        direction: 'pull',
        strategy: 'remote_wins',
      })
    })

    it('shows conflict files in resolution section', async () => {
      await renderWithConflicts()

      expect(screen.getByText('Resolve conflicts')).toBeTruthy()
      expect(screen.getByText(/Conflicting files:.*file1\.md.*file2\.md/)).toBeTruthy()
    })

    it('clears conflict state on successful resolution', async () => {
      await renderWithConflicts()

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'resolved' }))
        .mockResolvedValueOnce(jsonResponse(readySummary))

      fireEvent.click(screen.getByText('Keep local version'))

      await waitFor(() =>
        expect(screen.getByText('Conflicts resolved successfully.')).toBeTruthy(),
      )
      expect(screen.queryByText('Resolve conflicts')).toBeNull()
    })
  })

  describe('test connection', () => {
    it('tests connection successfully', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: true, message: 'Connected to owner/repo' }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Test Connection')).toBeTruthy())

      fireEvent.click(screen.getByText('Test Connection'))

      await waitFor(() =>
        expect(screen.getByText('Connected to owner/repo')).toBeTruthy(),
      )
    })

    it('shows default success message when none provided', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Test Connection')).toBeTruthy())

      fireEvent.click(screen.getByText('Test Connection'))

      await waitFor(() =>
        expect(screen.getByText('Connection successful.')).toBeTruthy(),
      )
    })

    it('shows test failure message', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: false, message: 'Token expired' }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Test Connection')).toBeTruthy())

      fireEvent.click(screen.getByText('Test Connection'))

      await waitFor(() =>
        expect(screen.getByText('Token expired')).toBeTruthy(),
      )
    })

    it('shows default failure message when none provided', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ ok: false }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Test Connection')).toBeTruthy())

      fireEvent.click(screen.getByText('Test Connection'))

      await waitFor(() =>
        expect(screen.getByText('Connection test failed.')).toBeTruthy(),
      )
    })

    it('handles test connection API error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse({ error: 'not_configured' }, { status: 400 }))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Test Connection')).toBeTruthy())

      fireEvent.click(screen.getByText('Test Connection'))

      await waitFor(() =>
        expect(screen.getByText('GitHub App is not configured.')).toBeTruthy(),
      )
    })

    it('handles test connection network error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockRejectedValueOnce(new Error('offline'))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Test Connection')).toBeTruthy())

      fireEvent.click(screen.getByText('Test Connection'))

      await waitFor(() =>
        expect(screen.getByText('Could not reach the server.')).toBeTruthy(),
      )
    })
  })

  describe('error messages', () => {
    it('maps all known error codes', async () => {
      const knownCodes = [
        'forbidden', 'missing_code', 'exchange_failed', 'missing_installation_id',
        'invalid_installation_id', 'not_configured', 'not_installed', 'not_ready',
        'verification_failed', 'invalid_direction', 'repo_not_found', 'network_error',
      ]

      for (const code of knownCodes) {
        fetchMock.mockReset()
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: code }, { status: 400 }))
        const { unmount } = await renderPanel()
        await waitFor(() => expect(screen.getByTestId('info-box-error')).toBeTruthy())
        const text = screen.getByTestId('info-box-error').textContent
        expect(text).not.toBe(code)
        expect(text).not.toBe('Something went wrong.')
        unmount()
        vi.resetModules()
      }
    })

    it('falls back to "Something went wrong" for empty error', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: '' }, { status: 400 }))

      await renderPanel()

      await waitFor(() =>
        expect(screen.getByText('Something went wrong.')).toBeTruthy(),
      )
    })
  })

  describe('disconnect in ready state', () => {
    it('disconnects from ready state', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(readySummary))
        .mockResolvedValueOnce(jsonResponse(baseSummary))

      await renderPanel()
      await waitFor(() => expect(screen.getByText('Push to GitHub')).toBeTruthy())

      fireEvent.click(screen.getByText('Disconnect'))

      await waitFor(() =>
        expect(screen.getByText('Disconnected from GitHub.')).toBeTruthy(),
      )
    })
  })
})
