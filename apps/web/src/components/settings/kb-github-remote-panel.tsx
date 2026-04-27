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
} from '@/lib/kb-github-remote/types'

type KbGithubRemotePanelProps = {
  slug: string
}

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Only admins can manage the GitHub KB Backup integration.',
  invalid_body: 'The request body was invalid.',
  invalid_json: 'The request body was invalid JSON.',
  missing_repo_url: 'Repository URL is required.',
  invalid_repo_url: 'Repository URL must start with https://.',
  missing_pat: 'A Personal Access Token is required when saving for the first time.',
  not_configured: 'GitHub remote is not configured. Save credentials first.',
  invalid_direction: 'Invalid sync direction.',
  network_error: 'Could not reach the server.',
}

function getErrorMessage(error: string | undefined): string {
  if (!error) return 'Something went wrong.'
  return ERROR_MESSAGES[error] ?? error
}

type BusyAction = 'save' | 'clear' | 'test' | 'push' | 'pull' | null

export function KbGithubRemotePanel({ slug }: KbGithubRemotePanelProps) {
  const [repoUrl, setRepoUrl] = useState('')
  const [pat, setPat] = useState('')
  const [integration, setIntegration] = useState<KbGithubRemoteIntegrationGetResponse | null>(null)
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

      if (!response.ok || !data || !('configured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setRepoUrl(data.repoUrl ?? '')
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
          repoUrl: repoUrl.trim(),
          pat: pat.trim() || undefined,
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (KbGithubRemoteIntegrationMutateResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('configured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setRepoUrl(data.repoUrl ?? '')
      setPat('')
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

      if (!response.ok || !data || !('configured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setRepoUrl('')
      setPat('')
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
        remoteBranch?: string
        status?: string
        message?: string
        error?: string
      } | null

      if (!response.ok || !data) {
        setError(getErrorMessage(data?.error))
        return
      }

      if (data.ok) {
        setSuccess(`Connection successful. Remote branch: ${data.remoteBranch ?? 'main'}`)
        void loadIntegration()
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
        commitHash?: string
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
        setError('Push rejected. The remote has changes that are not in your local KB. Pull first.')
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

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">GitHub KB Backup</h2>
          {loadingIndicator}
        </div>
        <p className="text-sm text-muted-foreground">
          Back up your knowledge base to a GitHub repository. Changes can be pushed and pulled between your
          local KB and the remote.
        </p>
      </div>

      {error ? <SettingsInfoBox tone="error">{error}</SettingsInfoBox> : null}
      {success ? <SettingsInfoBox tone="success">{success}</SettingsInfoBox> : null}

      <div className="space-y-6 pt-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Setup instructions</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Create a GitHub repository (public or private) to store your knowledge base.</li>
            <li>
              Generate a{' '}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=Arche+KB+Backup"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Personal Access Token
              </a>{' '}
              with the <code className="rounded bg-muted px-1 text-xs">repo</code> scope.
            </li>
            <li>Enter the repository URL and token below, then save.</li>
            <li>Use &ldquo;Test Connection&rdquo; to verify access.</li>
          </ol>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="kb-repo-url" className="text-sm font-medium text-foreground">
              Repository URL
            </label>
            <Input
              id="kb-repo-url"
              type="text"
              placeholder="https://github.com/owner/repo.git"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              disabled={busyAction !== null}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="kb-pat" className="text-sm font-medium text-foreground">
              Personal Access Token
            </label>
            <Input
              id="kb-pat"
              type="password"
              placeholder={integration?.hasPat ? 'Saved. Leave blank to keep existing.' : 'ghp_...'}
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              disabled={busyAction !== null}
            />
            {integration?.hasPat ? (
              <p className="text-xs text-muted-foreground">Leave blank to preserve the existing saved token.</p>
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
            {integration?.configured ? (
              <>
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

        {integration?.configured ? (
          <div className="space-y-4 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">Sync</h3>
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
          </div>
        ) : null}
      </div>
    </section>
  )
}
