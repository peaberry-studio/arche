'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowsClockwise, SpinnerGap } from '@phosphor-icons/react'

import { SettingsInfoBox } from '@/components/settings/settings-info-box'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  KbGithubRemoteIntegrationGetResponse,
  KbGithubRemoteRepo,
} from '@/lib/kb-github-remote/types'

type KbGithubRemotePanelProps = {
  slug: string
}

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Only admins can manage the GitHub KB Backup integration.',
  missing_code: 'GitHub did not return an authorization code.',
  exchange_failed: 'Failed to create the GitHub App. The code may have expired — try again.',
  missing_installation_id: 'GitHub did not return an installation ID.',
  invalid_installation_id: 'The installation ID from GitHub was invalid.',
  not_configured: 'GitHub App is not configured.',
  not_installed: 'GitHub App is not installed. Click "Install on GitHub" first.',
  not_ready: 'No repository selected. Select a repository first.',
  verification_failed: 'Could not verify the GitHub App installation.',
  invalid_direction: 'Invalid sync direction.',
  network_error: 'Could not reach the server.',
}

function getErrorMessage(error: string | undefined): string {
  if (!error) return 'Something went wrong.'
  return ERROR_MESSAGES[error] ?? error
}

type BusyAction = 'clear' | 'test' | 'push' | 'pull' | 'repos' | null

export function KbGithubRemotePanel({ slug }: KbGithubRemotePanelProps) {
  const [integration, setIntegration] = useState<KbGithubRemoteIntegrationGetResponse | null>(null)
  const [repos, setRepos] = useState<KbGithubRemoteRepo[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get('error')
    const appCreated = params.get('app_created')
    const installed = params.get('installed')

    if (errorParam) {
      setError(getErrorMessage(errorParam))
    } else if (appCreated === 'true') {
      setSuccess('GitHub App created successfully. Now install it on your account.')
    } else if (installed === 'true') {
      setSuccess('GitHub App installed. Select a repository to complete setup.')
    }

    if (errorParam || appCreated || installed) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const loadIntegration = useCallback(async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | (KbGithubRemoteIntegrationGetResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('appConfigured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadIntegration()
  }, [loadIntegration])

  function handleConnectGithub() {
    const origin = window.location.origin
    const manifest = {
      name: 'Arche KB Sync',
      url: origin,
      redirect_url: `${origin}/api/u/${slug}/kb-github-remote/setup`,
      setup_url: `${origin}/api/u/${slug}/kb-github-remote/callback`,
      public: false,
      default_permissions: {
        contents: 'write',
        metadata: 'read',
      },
      default_events: [],
    }

    const input = formRef.current?.querySelector<HTMLInputElement>('input[name="manifest"]')
    if (input) {
      input.value = JSON.stringify(manifest)
      formRef.current?.submit()
    }
  }

  async function handleDisconnect() {
    setBusyAction('clear')
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote`, {
        method: 'DELETE',
      })
      const data = (await response.json().catch(() => null)) as
        | (KbGithubRemoteIntegrationGetResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('appConfigured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setRepos(null)
      setSuccess('Disconnected from GitHub.')
      window.setTimeout(() => setSuccess(null), 3000)
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
      const response = await fetch(`/api/u/${slug}/kb-github-remote/test`, {
        method: 'POST',
      })
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        message?: string
        error?: string
      } | null

      if (!response.ok || !data) {
        setError(getErrorMessage(data?.error))
        return
      }

      if (data.ok) {
        setSuccess(data.message ?? 'Connection successful.')
        window.setTimeout(() => setSuccess(null), 5000)
      } else {
        setError(data.message ?? 'Connection test failed.')
      }
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleLoadRepos() {
    setBusyAction('repos')
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote/repos`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as {
        repos?: KbGithubRemoteRepo[]
        error?: string
      } | null

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
    setBusyAction('repos')
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote/repos`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoFullName: repo.fullName, repoCloneUrl: repo.cloneUrl }),
      })
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
      } | null

      if (!response.ok || !data?.ok) {
        setError(getErrorMessage(data?.error))
        return
      }

      setRepos(null)
      setSuccess(`Repository "${repo.fullName}" selected.`)
      void loadIntegration()
      window.setTimeout(() => setSuccess(null), 5000)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSync(direction: 'push' | 'pull') {
    setBusyAction(direction)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        status?: string
        message?: string
        conflictingFiles?: string[]
        error?: string
      } | null

      if (!response.ok || !data) {
        setError(getErrorMessage(data?.error))
        return
      }

      if (data.ok) {
        const label = direction === 'push' ? 'Pushed' : 'Pulled'
        const detail = data.status === 'up_to_date' ? 'Already up to date.' : `${label} successfully.`
        setSuccess(detail)
        void loadIntegration()
        window.setTimeout(() => setSuccess(null), 5000)
      } else if (data.status === 'conflicts') {
        setError(
          `Merge conflicts detected in ${data.conflictingFiles?.length ?? 0} file(s): ${data.conflictingFiles?.join(', ') ?? 'unknown'}`,
        )
      } else if (data.status === 'push_rejected') {
        setError('Push rejected. The remote has changes not in your local KB. Pull first.')
      } else {
        setError(data.message ?? `${direction === 'push' ? 'Push' : 'Pull'} failed.`)
      }
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  const loadingIndicator = isLoading ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <SpinnerGap size={14} className="animate-spin" />
      Loading…
    </span>
  ) : null

  const showConnectButton = !integration?.appConfigured
  const showInstallButton = integration?.appConfigured && !integration.installationId
  const showRepoPicker = integration?.appConfigured && integration.installationId && !integration.repoFullName
  const showSyncControls = integration?.ready

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">GitHub KB Backup</h2>
          {loadingIndicator}
        </div>
        <p className="text-sm text-muted-foreground">
          Back up your knowledge base to a GitHub repository using a GitHub App for secure, token-free authentication.
        </p>
      </div>

      {error ? <SettingsInfoBox tone="error">{error}</SettingsInfoBox> : null}
      {success ? <SettingsInfoBox tone="success">{success}</SettingsInfoBox> : null}

      <div className="space-y-6 pt-2">
        {showConnectButton ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Click below to create and register a GitHub App for this deployment. You will be redirected to GitHub to approve the app.
            </p>
            <form
              ref={formRef}
              action="https://github.com/settings/apps/new"
              method="post"
            >
              <input type="hidden" name="manifest" value="" />
              <Button
                type="button"
                disabled={busyAction !== null}
                onClick={handleConnectGithub}
              >
                Connect to GitHub
              </Button>
            </form>
          </div>
        ) : null}

        {showInstallButton ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">Install the GitHub App</h3>
              <Badge variant="default">App created</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Install the app on a GitHub account or organization to grant repository access.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                asChild
              >
                <a href={`/api/u/${slug}/kb-github-remote/install`}>
                  Install on GitHub
                </a>
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busyAction !== null}
                onClick={() => void handleDisconnect()}
              >
                {busyAction === 'clear' ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            </div>
          </div>
        ) : null}

        {showRepoPicker ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">Select a repository</h3>
              <Badge variant="default">Installed</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Choose which repository to use for KB backup.
            </p>

            {repos === null ? (
              <Button
                type="button"
                variant="outline"
                disabled={busyAction !== null}
                onClick={() => void handleLoadRepos()}
              >
                {busyAction === 'repos' ? 'Loading...' : 'Load repositories'}
              </Button>
            ) : repos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No repositories found. Check that the app is installed on at least one repository.
              </p>
            ) : (
              <div className="space-y-2">
                {repos.map((repo) => (
                  <button
                    key={repo.fullName}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-border/60 bg-background px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-50"
                    disabled={busyAction !== null}
                    onClick={() => void handleSelectRepo(repo)}
                  >
                    <span className="font-medium">{repo.fullName}</span>
                    <Badge variant="secondary">{repo.private ? 'Private' : 'Public'}</Badge>
                  </button>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busyAction !== null}
              onClick={() => void handleDisconnect()}
            >
              {busyAction === 'clear' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>
        ) : null}

        {integration?.installationId && integration.repoFullName ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">Connected repository</h3>
              <Badge variant="default">{integration.repoFullName}</Badge>
            </div>

            {showSyncControls ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {integration.lastSyncStatus === 'success' ? (
                    <Badge variant="default">Last sync successful</Badge>
                  ) : null}
                  {integration.lastSyncStatus === 'error' ? (
                    <Badge variant="destructive">Last sync failed</Badge>
                  ) : null}
                  {integration.lastSyncStatus === 'conflicts' ? (
                    <Badge variant="secondary" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                      Conflicts
                    </Badge>
                  ) : null}
                </div>

                {integration.lastSyncAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last synced {new Date(integration.lastSyncAt).toLocaleString()}
                    {integration.remoteBranch ? ` on branch ${integration.remoteBranch}` : ''}
                  </p>
                ) : null}

                {integration.lastError ? (
                  <p className="text-xs text-red-600 dark:text-red-400">{integration.lastError}</p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => void handleTestConnection()}
                  >
                    {busyAction === 'test' ? 'Testing...' : 'Test Connection'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => void handleSync('push')}
                  >
                    <ArrowsClockwise size={14} className={busyAction === 'push' ? 'animate-spin' : ''} />
                    {busyAction === 'push' ? 'Pushing...' : 'Push to GitHub'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => void handleSync('pull')}
                  >
                    <ArrowsClockwise size={14} className={busyAction === 'pull' ? 'animate-spin' : ''} />
                    {busyAction === 'pull' ? 'Pulling...' : 'Pull from GitHub'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => void handleDisconnect()}
                  >
                    {busyAction === 'clear' ? 'Disconnecting...' : 'Disconnect'}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
