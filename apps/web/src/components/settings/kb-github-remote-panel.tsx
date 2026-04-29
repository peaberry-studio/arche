'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowsClockwise, SpinnerGap } from '@phosphor-icons/react'

import { SettingsInfoBox } from '@/components/settings/settings-info-box'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  KbGithubRemoteIntegrationGetResponse,
  KbGithubRemoteIntegrationMutateResponse,
  KbGithubRemoteRepo,
} from '@/lib/kb-github-remote/types'

type KbGithubRemotePanelProps = {
  slug: string
}

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Only admins can manage the GitHub KB Backup integration.',
  invalid_body: 'The request body was invalid.',
  invalid_json: 'The request body was invalid JSON.',
  missing_app_id: 'App ID is required.',
  missing_private_key: 'A private key is required when saving for the first time.',
  missing_app_slug: 'App slug is required to install the GitHub App.',
  not_configured: 'GitHub App is not configured. Save credentials first.',
  not_installed: 'GitHub App is not installed. Click "Install on GitHub" first.',
  not_ready: 'No repository selected. Select a repository first.',
  invalid_direction: 'Invalid sync direction.',
  network_error: 'Could not reach the server.',
}

function getErrorMessage(error: string | undefined): string {
  if (!error) return 'Something went wrong.'
  return ERROR_MESSAGES[error] ?? error
}

type BusyAction = 'save' | 'clear' | 'test' | 'push' | 'pull' | 'repos' | null

export function KbGithubRemotePanel({ slug }: KbGithubRemotePanelProps) {
  const [appId, setAppId] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [appSlug, setAppSlug] = useState('')
  const [integration, setIntegration] = useState<KbGithubRemoteIntegrationGetResponse | null>(null)
  const [repos, setRepos] = useState<KbGithubRemoteRepo[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadIntegration = useCallback(async () => {
    setIsLoading(true)
    setError(null)

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
      setAppId(data.appId ?? '')
      setAppSlug(data.appSlug ?? '')
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadIntegration()
  }, [loadIntegration])

  async function handleSave() {
    setBusyAction('save')
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appId: appId.trim(),
          privateKey: privateKey.trim() || undefined,
          appSlug: appSlug.trim() || undefined,
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (KbGithubRemoteIntegrationMutateResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('appConfigured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setAppId(data.appId ?? '')
      setAppSlug(data.appSlug ?? '')
      setPrivateKey('')
      setSuccess('Configuration saved.')
      window.setTimeout(() => setSuccess(null), 3000)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleClear() {
    setBusyAction('clear')
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/u/${slug}/kb-github-remote`, {
        method: 'DELETE',
      })
      const data = (await response.json().catch(() => null)) as
        | (KbGithubRemoteIntegrationMutateResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('appConfigured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setAppId('')
      setAppSlug('')
      setPrivateKey('')
      setRepos(null)
      setSuccess('Configuration cleared.')
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
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Setup instructions</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Create a{' '}
              <a
                href="https://github.com/settings/apps/new"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                GitHub App
              </a>{' '}
              with <strong>Contents: Read &amp; Write</strong> permission. Disable webhooks.
            </li>
            <li>
              Set the Setup URL to:{' '}
              <code className="rounded bg-muted px-1 text-xs">
                {typeof window !== 'undefined' ? window.location.origin : ''}/api/u/{slug}/kb-github-remote/callback
              </code>
            </li>
            <li>Enter the App ID, app slug, and private key below, then save.</li>
            <li>Click &ldquo;Install on GitHub&rdquo; to install the app on your repository.</li>
            <li>Select the repository to sync with.</li>
          </ol>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="kb-app-id" className="text-sm font-medium text-foreground">
                App ID
              </label>
              <Input
                id="kb-app-id"
                type="text"
                placeholder="123456"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                disabled={busyAction !== null}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="kb-app-slug" className="text-sm font-medium text-foreground">
                App slug
              </label>
              <Input
                id="kb-app-slug"
                type="text"
                placeholder="my-arche-kb-backup"
                value={appSlug}
                onChange={(event) => setAppSlug(event.target.value)}
                disabled={busyAction !== null}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="kb-private-key" className="text-sm font-medium text-foreground">
              Private key (PEM)
            </label>
            <textarea
              id="kb-private-key"
              className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={integration?.hasPrivateKey ? 'Saved. Leave blank to keep existing.' : '-----BEGIN RSA PRIVATE KEY-----\n...'}
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              disabled={busyAction !== null}
            />
            {integration?.hasPrivateKey ? (
              <p className="text-xs text-muted-foreground">Leave blank to preserve the existing saved key.</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleSave()}
            >
              {busyAction === 'save' ? 'Saving...' : 'Save'}
            </Button>
            {integration?.appConfigured ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busyAction !== null}
                  onClick={() => void handleClear()}
                >
                  {busyAction === 'clear' ? 'Clearing...' : 'Clear credentials'}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {showInstallButton ? (
          <div className="space-y-3 border-t border-border/60 pt-4">
            <h3 className="text-sm font-medium text-foreground">Install the GitHub App</h3>
            <p className="text-sm text-muted-foreground">
              Install the app on a GitHub account or organization to grant repository access.
            </p>
            <Button
              type="button"
              variant="outline"
              asChild
            >
              <a href={`/api/u/${slug}/kb-github-remote/install`}>
                Install on GitHub
              </a>
            </Button>
          </div>
        ) : null}

        {showRepoPicker ? (
          <div className="space-y-3 border-t border-border/60 pt-4">
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
          </div>
        ) : null}

        {integration?.installationId && integration.repoFullName ? (
          <div className="space-y-3 border-t border-border/60 pt-4">
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
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
