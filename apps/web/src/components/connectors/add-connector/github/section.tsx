'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import { X } from 'lucide-react'

import { ManualApiKeyField } from '@/components/connectors/add-connector/manual-api-key-field'
import { buildDefaultName } from '@/components/connectors/add-connector/shared'
import {
  type AddConnectorSectionHandle,
  type AddConnectorSectionProps,
  type AddConnectorSubmissionResult,
  useNotifyStateChange,
} from '@/components/connectors/add-connector/section-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isGithubPinnedRepo } from '@/lib/connectors/github'

import {
  buildGithubConnectorConfig,
  isGithubConnectorConfigurationComplete,
} from './config'

export const GithubSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function GithubSection({ onStateChange, isActive }, ref) {
  const [pat, setPat] = useState('')
  const [pinnedRepos, setPinnedRepos] = useState<string[]>([])
  const [repoInput, setRepoInput] = useState('')
  const [repoError, setRepoError] = useState<string | null>(null)

  const state = {
    selectedType: 'github' as const,
    pat,
    pinnedRepos,
  }

  useNotifyStateChange(onStateChange, state)

  function includesRepo(repos: string[], repo: string): boolean {
    return repos.some((item) => item.toLowerCase() === repo.toLowerCase())
  }

  function addPinnedRepo() {
    const repo = repoInput.trim()
    if (!isGithubPinnedRepo(repo)) {
      setRepoError('Enter a repository as owner/repository.')
      return
    }

    setPinnedRepos((current) =>
      includesRepo(current, repo) ? current : [...current, repo]
    )
    setRepoInput('')
    setRepoError(null)
  }

  useImperativeHandle(ref, () => ({
    isComplete: () => isGithubConnectorConfigurationComplete(state),
    getSubmission: (): AddConnectorSubmissionResult => {
      // Commit a valid repo left in the input but not yet added so it isn't
      // silently dropped when the user clicks Save without pressing Enter/Add.
      const pendingRepo = repoInput.trim()
      const submissionState =
        isGithubPinnedRepo(pendingRepo) && !includesRepo(pinnedRepos, pendingRepo)
          ? { ...state, pinnedRepos: [...pinnedRepos, pendingRepo] }
          : state

      const configResult = buildGithubConnectorConfig(submissionState)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }

      return {
        ok: true,
        name: buildDefaultName('github'),
        config: configResult.value,
      }
    },
  }))

  if (!isActive) return null

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-foreground">Name</Label>
        <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground">
          {buildDefaultName('github')}
        </p>
      </div>

      <ManualApiKeyField
        id="connector-github-pat"
        label="Personal access token"
        placeholder="github_pat_..."
        value={pat}
        onChange={setPat}
        helperText="Use a fine-grained token with read access limited to the repositories below."
      />

      <div className="space-y-2">
        <Label htmlFor="connector-github-pinned-repo" className="text-foreground">
          Pinned repositories
        </Label>
        <div className="flex gap-2">
          <Input
            id="connector-github-pinned-repo"
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
          />
          <Button type="button" variant="outline" onClick={addPinnedRepo}>
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Press Enter or Add after each repository. These repositories guide agents to the most relevant source code.
        </p>
        {repoError ? <p className="text-xs text-destructive">{repoError}</p> : null}
        {pinnedRepos.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Added pinned repositories">
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
                  onClick={() => setPinnedRepos((current) => current.filter((item) => item !== repo))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
})
