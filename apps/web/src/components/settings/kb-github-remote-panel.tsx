'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, SpinnerGap } from '@phosphor-icons/react'

import { ensureInstanceRunningAction } from '@/actions/spawner'
import { SettingsInfoBox } from '@/components/settings/settings-info-box'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  KbGithubRemoteIntegrationSummary,
  KbGithubRemoteRepo,
} from '@/lib/kb-github-remote/types'
import { cn } from '@/lib/utils'

type KbGithubRemotePanelProps = {
  initialError?: string | null
  initialIntegration: KbGithubRemoteIntegrationSummary
  slug: string
}

type BusyAction = 'connect' | 'disconnect' | 'repos' | 'select' | 'sync' | 'test' | null
type GitHubAppOwnerMode = 'personal' | 'organization'

type InitialFeedback = {
  error: string | null
  shouldClearUrl: boolean
  success: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  exchange_failed: 'GitHub App creation failed. The manifest code may have expired.',
  forbidden: 'Only admins can manage GitHub KB sync.',
  invalid_body: 'The request body was invalid.',
  invalid_installation_id: 'GitHub returned an invalid installation ID.',
  invalid_owner: 'Enter a valid GitHub organization name before creating the app.',
  invalid_state: 'GitHub setup state expired. Start the GitHub setup again.',
  invalid_json: 'The request body was invalid JSON.',
  missing_code: 'GitHub did not return an app manifest code.',
  missing_repo: 'Choose a GitHub repository first.',
  network_error: 'Could not reach the server.',
  not_configured: 'Create the GitHub App before continuing.',
  not_installed: 'Install the GitHub App before selecting a repository.',
  repo_not_found: 'The selected repository is not available to the GitHub App installation.',
  setup_required: 'Finish Kickstart setup before syncing the knowledge base.',
  start_timeout: 'The workspace is still starting. Try syncing again in a moment.',
  status_check_failed: 'Could not start the workspace for sync.',
  unauthorized: 'Sign in again before continuing.',
  verification_failed: 'Could not verify the GitHub App installation.',
}

const INSTANCE_START_POLL_INTERVAL_MS = 2_000
const INSTANCE_START_TIMEOUT_MS = 120_000
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/

export function KbGithubRemotePanel({ initialError, initialIntegration, slug }: KbGithubRemotePanelProps) {
  const [initialFeedback] = useState<InitialFeedback>(() => getInitialFeedback())
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [error, setError] = useState<string | null>(initialFeedback.error ?? (initialError ? getErrorMessage(initialError) : null))
  const [githubAppOwnerMode, setGithubAppOwnerMode] = useState<GitHubAppOwnerMode>('personal')
  const [githubOrganization, setGithubOrganization] = useState('')
  const [integration, setIntegration] = useState<KbGithubRemoteIntegrationSummary | null>(initialIntegration)
  const [repos, setRepos] = useState<KbGithubRemoteRepo[] | null>(null)
  const [success, setSuccess] = useState<string | null>(initialFeedback.success)

  const loadIntegration = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as (KbGithubRemoteIntegrationSummary & { error?: string }) | null

      if (!response.ok || !data || !('appConfigured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
    } catch {
      setError(getErrorMessage('network_error'))
    }
  }, [slug])

  useEffect(() => {
    if (initialFeedback.shouldClearUrl) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [initialFeedback.shouldClearUrl])

  const shouldShowRepos = Boolean(integration?.appConfigured && integration.installationId && !integration.repoFullName)
  useEffect(() => {
    if (shouldShowRepos && repos === null && busyAction === null) {
      void loadRepos()
    }
  }, [busyAction, repos, shouldShowRepos]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = useMemo(() => {
    if (!integration) return 'Loading'
    if (integration.ready) return 'Connected'
    if (integration.installationId) return 'Repository needed'
    if (integration.appConfigured) return 'Install app'
    return 'Not configured'
  }, [integration])

  async function handleConnectGithub() {
    const owner = githubOrganization.trim()
    if (githubAppOwnerMode === 'organization' && !GITHUB_OWNER_PATTERN.test(owner)) {
      setError(getErrorMessage('invalid_owner'))
      return
    }

    setBusyAction('connect')
    setError(null)
    setSuccess(null)

    const params = new URLSearchParams()
    if (githubAppOwnerMode === 'organization') {
      params.set('owner', owner)
    }
    const qs = params.toString()
    window.location.href = `/api/u/${slug}/kb-github-remote/manifest${qs ? `?${qs}` : ''}`
  }

  async function handleDisconnect() {
    setBusyAction('disconnect')
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote`, { method: 'DELETE' })
      const data = await response.json().catch(() => null) as (KbGithubRemoteIntegrationSummary & { error?: string }) | null
      if (!response.ok || !data || !('appConfigured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setRepos(null)
      setSuccess('GitHub KB sync disconnected.')
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function loadRepos() {
    setBusyAction('repos')
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote/repos`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { error?: string; repos?: KbGithubRemoteRepo[] } | null
      if (!response.ok || !data?.repos) {
        setError(getErrorMessage(data?.error))
        return
      }

      setRepos(data.repos)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSelectRepo(repo: KbGithubRemoteRepo) {
    setBusyAction('select')
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote/repos`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoFullName: repo.fullName }),
      })
      const data = await response.json().catch(() => null) as { error?: string; ok?: boolean } | null
      if (!response.ok || !data?.ok) {
        setError(getErrorMessage(data?.error))
        return
      }

      setRepos(null)
      setSuccess(`Repository ${repo.fullName} selected. Run the initial sync to publish local KB content.`)
      await loadIntegration()
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleTestConnection() {
    setBusyAction('test')
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote/test`, { method: 'POST' })
      const data = await response.json().catch(() => null) as { error?: string; message?: string; ok?: boolean } | null
      if (!response.ok || !data) {
        setError(getErrorMessage(data?.error))
        return
      }

      if (!data.ok) {
        setError(data.message ?? 'GitHub connection test failed.')
        return
      }

      setSuccess(data.message ?? 'GitHub connection test succeeded.')
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleInitialSync() {
    setBusyAction('sync')
    setError(null)
    setSuccess(null)

    try {
      const workspace = await waitForWorkspace()
      if (!workspace.ok) {
        setError(getErrorMessage(workspace.error))
        return
      }

      const response = await fetch(`/api/instances/${slug}/publish-kb`, { method: 'POST' })
      const data = await response.json().catch(() => null) as { error?: string; message?: string; status?: string } | null
      if (response.status === 409) {
        setError(getErrorMessage('start_timeout'))
        return
      }
      if (!response.ok || !data) {
        setError(getErrorMessage(data?.error))
        return
      }
      if (data.status === 'conflicts') {
        setError('Sync found conflicts. Open the Knowledge Review panel to resolve them.')
        return
      }
      if (data.status === 'error' || data.status === 'push_rejected') {
        setError(data.message ?? 'Initial sync failed.')
        return
      }

      setSuccess(data.status === 'nothing_to_publish' ? 'GitHub repository is already up to date.' : 'Knowledge base synced to GitHub.')
      await loadIntegration()
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function waitForWorkspace(): Promise<{ ok: true } | { ok: false; error: string }> {
    const deadline = Date.now() + INSTANCE_START_TIMEOUT_MS

    while (Date.now() < deadline) {
      const result = await ensureInstanceRunningAction(slug)
      if (result.status === 'running') return { ok: true }
      if (result.status === 'error') return { ok: false, error: result.error ?? 'status_check_failed' }
      await delay(INSTANCE_START_POLL_INTERVAL_MS)
    }

    return { ok: false, error: 'start_timeout' }
  }

  return (
    <section className="space-y-5 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">GitHub KB sync</h2>
            <Badge variant={integration?.ready ? 'default' : 'secondary'}>{statusLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Connect the deployment-wide shared knowledge base to a GitHub repository. Arche uses a GitHub App and short-lived installation tokens.
          </p>
        </div>
      </div>

      {error ? <SettingsInfoBox tone="error">{error}</SettingsInfoBox> : null}
      {success ? <SettingsInfoBox tone="success">{success}</SettingsInfoBox> : null}

      {!integration?.appConfigured ? (
        <div className="space-y-3">
          <SettingsInfoBox>
            Create a GitHub App from a manifest, then install it on the repository you want to use for KB sync.
          </SettingsInfoBox>
          <GitHubAppOwnerSelector
            mode={githubAppOwnerMode}
            organization={githubOrganization}
            onModeChange={setGithubAppOwnerMode}
            onOrganizationChange={setGithubOrganization}
          />
          <Button type="button" disabled={busyAction !== null} onClick={handleConnectGithub}>
            {busyAction === 'connect' ? 'Opening GitHub…' : 'Connect GitHub'}
          </Button>
        </div>
      ) : null}

      {integration?.appConfigured && !integration.installationId ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            GitHub App created. Install it on an account or organization to grant repository access.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={`/api/u/${slug}/kb-github-remote/install`}>Install on GitHub</a>
            </Button>
            <DisconnectButton busyAction={busyAction} onDisconnect={handleDisconnect} />
          </div>
        </div>
      ) : null}

      {shouldShowRepos ? (
        <RepoPicker
          busyAction={busyAction}
          onLoadRepos={loadRepos}
          onSelectRepo={handleSelectRepo}
          repos={repos}
        />
      ) : null}

      {integration?.ready ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-background/50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{integration.repoFullName}</p>
              <Badge variant="default">Connected</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Branch: {integration.repoDefaultBranch ?? 'main'}
              {integration.installationAccount ? ` · Installed on ${integration.installationAccount}` : ''}
            </p>
            {integration.lastSyncAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Last sync: {new Date(integration.lastSyncAt).toLocaleString()}
              </p>
            ) : null}
            {integration.lastError ? (
              <p className="mt-2 text-xs text-destructive">{integration.lastError}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busyAction !== null} onClick={() => void handleInitialSync()}>
              <ArrowsClockwise size={14} className={cn(busyAction === 'sync' && 'animate-spin')} />
              {busyAction === 'sync' ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button type="button" variant="outline" disabled={busyAction !== null} onClick={() => void handleTestConnection()}>
              {busyAction === 'test' ? 'Testing…' : 'Test connection'}
            </Button>
            <Button type="button" variant="outline" disabled={busyAction !== null} onClick={() => void loadRepos()}>
              Change repo
            </Button>
            <DisconnectButton busyAction={busyAction} onDisconnect={handleDisconnect} />
          </div>

          {repos ? (
            <RepoPicker
              busyAction={busyAction}
              onLoadRepos={loadRepos}
              onSelectRepo={handleSelectRepo}
              repos={repos}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function GitHubAppOwnerSelector({
  mode,
  organization,
  onModeChange,
  onOrganizationChange,
}: {
  mode: GitHubAppOwnerMode
  organization: string
  onModeChange: (mode: GitHubAppOwnerMode) => void
  onOrganizationChange: (organization: string) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">Create the GitHub App under</p>
        <p className="text-xs text-muted-foreground">
          Organization apps require org owner or GitHub App manager permissions.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm text-foreground">
          <input
            type="radio"
            name="github-app-owner"
            value="personal"
            checked={mode === 'personal'}
            onChange={() => onModeChange('personal')}
            className="mt-1"
          />
          <span>
            <span className="block font-medium">Signed-in user</span>
            <span className="block text-xs text-muted-foreground">Create it in your personal GitHub account.</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm text-foreground">
          <input
            type="radio"
            name="github-app-owner"
            value="organization"
            checked={mode === 'organization'}
            onChange={() => onModeChange('organization')}
            className="mt-1"
          />
          <span>
            <span className="block font-medium">Organization</span>
            <span className="block text-xs text-muted-foreground">Create it in a GitHub organization you can manage.</span>
          </span>
        </label>
      </div>

      {mode === 'organization' ? (
        <label className="block space-y-1.5 text-sm text-foreground">
          <span className="font-medium">Organization name</span>
          <input
            type="text"
            value={organization}
            onChange={(event) => onOrganizationChange(event.target.value)}
            placeholder="acme"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </label>
      ) : null}
    </div>
  )
}

function RepoPicker({
  busyAction,
  onLoadRepos,
  onSelectRepo,
  repos,
}: {
  busyAction: BusyAction
  onLoadRepos: () => Promise<void>
  onSelectRepo: (repo: KbGithubRemoteRepo) => Promise<void>
  repos: KbGithubRemoteRepo[] | null
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Select repository</p>
          <p className="text-xs text-muted-foreground">Empty repositories work best for the first sync.</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busyAction !== null} onClick={() => void onLoadRepos()}>
          Refresh
        </Button>
      </div>

      {repos === null ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={14} className="animate-spin" /> Loading repositories…
        </p>
      ) : repos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No repositories are available to this GitHub App installation.</p>
      ) : (
        <div className="space-y-2">
          {repos.map((repo) => (
            <button
              key={repo.fullName}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"
              disabled={busyAction !== null}
              onClick={() => void onSelectRepo(repo)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{repo.fullName}</span>
                <span className="text-xs text-muted-foreground">Default branch: {repo.defaultBranch}</span>
              </span>
              <Badge variant="secondary">{repo.private ? 'Private' : 'Public'}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DisconnectButton({
  busyAction,
  onDisconnect,
}: {
  busyAction: BusyAction
  onDisconnect: () => Promise<void>
}) {
  return (
    <Button type="button" variant="destructive" disabled={busyAction !== null} onClick={() => void onDisconnect()}>
      {busyAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
    </Button>
  )
}

function getErrorMessage(error: string | undefined): string {
  if (!error) return 'Something went wrong.'
  return ERROR_MESSAGES[error] ?? error
}

function getInitialFeedback(): InitialFeedback {
  if (typeof window === 'undefined') {
    return { error: null, shouldClearUrl: false, success: null }
  }

  const params = new URLSearchParams(window.location.search)
  const errorParam = params.get('error')
  const installed = params.get('installed')

  return {
    error: errorParam ? getErrorMessage(errorParam) : null,
    shouldClearUrl: Boolean(errorParam || installed),
    success: !errorParam && installed === 'true'
      ? 'GitHub App installed. Select a repository to finish setup.'
      : null,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
