'use client'

import { useEffect, useState } from 'react'
import { SpinnerGap, X } from '@phosphor-icons/react'

import { ConnectorToolPermissionsSection } from '@/components/connectors/connector-tool-permissions-section'
import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isGithubPinnedRepo } from '@/lib/connectors/github'

type GithubConnectorSettingsDialogProps = {
  open: boolean
  slug: string
  connectorId: string | null
  connectorName: string | null
  onOpenChange: (open: boolean) => void
}

function includesRepo(repos: string[], repo: string): boolean {
  return repos.some((item) => item.toLowerCase() === repo.toLowerCase())
}

export function GithubConnectorSettingsDialog({
  open,
  slug,
  connectorId,
  connectorName,
  onOpenChange,
}: GithubConnectorSettingsDialogProps) {
  const [pinnedRepos, setPinnedRepos] = useState<string[]>([])
  const [repoInput, setRepoInput] = useState('')
  const [repoError, setRepoError] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLoading = open && Boolean(connectorId) && !hasLoaded && error === null

  function resetState() {
    setPinnedRepos([])
    setRepoInput('')
    setRepoError(null)
    setHasLoaded(false)
    setIsSaving(false)
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  useEffect(() => {
    if (!open || !connectorId) return

    let cancelled = false

    async function loadConfig() {
      try {
        const response = await fetch(`/api/u/${slug}/connectors/${connectorId}`, {
          cache: 'no-store',
        })
        const data = (await response.json().catch(() => null)) as
          | { config?: { pinnedRepos?: string[] }; error?: string }
          | null

        if (cancelled) return

        if (!response.ok || !data) {
          setError(getConnectorErrorMessage(data, 'load_settings_failed'))
          return
        }

        setPinnedRepos(
          Array.isArray(data.config?.pinnedRepos) ? data.config.pinnedRepos : [],
        )
        setHasLoaded(true)
        setError(null)
      } catch {
        if (!cancelled) {
          setError(getConnectorErrorMessage(null, 'network_error'))
        }
      }
    }

    void loadConfig()

    return () => {
      cancelled = true
    }
  }, [connectorId, open, slug])

  function addPinnedRepo() {
    const repo = repoInput.trim()
    if (!isGithubPinnedRepo(repo)) {
      setRepoError('Enter a repository as owner/repository.')
      return
    }

    setPinnedRepos((current) =>
      includesRepo(current, repo) ? current : [...current, repo],
    )
    setRepoInput('')
    setRepoError(null)
  }

  async function handleSave() {
    if (!connectorId || !hasLoaded || isLoading || isSaving) return

    const pendingRepo = repoInput.trim()
    const finalRepos =
      isGithubPinnedRepo(pendingRepo) && !includesRepo(pinnedRepos, pendingRepo)
        ? [...pinnedRepos, pendingRepo]
        : pinnedRepos

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors/${connectorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { pinnedRepos: finalRepos } }),
      })
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null

      if (!response.ok) {
        setError(getConnectorErrorMessage(data, 'save_failed'))
        return
      }

      handleOpenChange(false)
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="scrollbar-custom max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>GitHub settings</DialogTitle>
          <DialogDescription>
            Manage pinned repositories for {connectorName ?? 'this connector'}.
            Pinned repositories guide agents toward the most relevant source code.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpinnerGap size={16} className="animate-spin" />
              Loading settings...
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {hasLoaded ? (
            <section className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="github-settings-pinned-repo" className="text-foreground">
                  Pinned repositories
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="github-settings-pinned-repo"
                    value={repoInput}
                    onChange={(event) => {
                      setRepoInput(event.target.value)
                      setRepoError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addPinnedRepo()
                      }
                    }}
                    placeholder="owner/repository"
                    disabled={isSaving}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={addPinnedRepo}
                  >
                    Add
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Press Enter or Add after each repository.
                </p>
                {repoError ? (
                  <p className="text-xs text-destructive">{repoError}</p>
                ) : null}
                {pinnedRepos.length > 0 ? (
                  <ul className="flex flex-wrap gap-2" aria-label="Pinned repositories">
                    {pinnedRepos.map((repo) => (
                      <li
                        key={repo}
                        className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-foreground"
                      >
                        <code>{repo}</code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 rounded-full text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${repo}`}
                          disabled={isSaving}
                          onClick={() =>
                            setPinnedRepos((current) =>
                              current.filter((item) => item !== repo),
                            )
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No pinned repositories. Add at least one to guide agents to relevant source code.
                  </p>
                )}
              </div>
            </section>
          ) : null}

          <ConnectorToolPermissionsSection
            connectorId={connectorId}
            enabled={open && hasLoaded}
            slug={slug}
          />

          <div className="flex justify-end gap-2">
            <Button
              disabled={isSaving}
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={isLoading || isSaving || !connectorId || !hasLoaded}
              onClick={() => void handleSave()}
            >
              {isSaving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
