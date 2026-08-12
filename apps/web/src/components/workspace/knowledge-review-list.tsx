'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MarkdownPreview } from '@/components/workspace/markdown-preview'
import { SegmentedControl, type SegmentedControlOption } from '@/components/workspace/segmented-control'
import type { KnowledgeReviewChange } from '@/types/learning'

type KnowledgeReviewListProps = {
  onApplied?: () => void | Promise<void>
  onChanged?: () => void | Promise<void>
  refreshKey?: number
  slug: string
}

type LearningResponse = {
  proposals: KnowledgeReviewChange[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isLearningResponse(value: unknown): value is LearningResponse {
  return isRecord(value) && Array.isArray(value.proposals)
}

function responseError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string' ? value.error : fallback
}

const ERROR_LABELS: Record<string, string> = {
  needs_rebase: 'The target file changed. Rebase the proposal before applying it.',
  not_found: 'Knowledge proposal not found.',
  not_open: 'This Knowledge proposal is no longer open.',
  not_rebaseable: 'This Knowledge proposal cannot be rebased.',
  file_exists: 'A file already exists at this path.',
  workspace_agent_unavailable: 'Start the workspace to apply this change.',
  invalid_request: 'The request was invalid.',
  knowledge_review_load_failed: 'Could not load Knowledge proposals.',
  knowledge_review_action_failed: 'The action failed. Try again.',
  knowledge_review_draft_failed: 'Could not save your edit. Try again.',
}

function errorLabel(error: string): string {
  return ERROR_LABELS[error] ?? error
}

type ViewMode = 'readable' | 'edit' | 'raw'

const VIEW_MODE_OPTIONS: SegmentedControlOption<ViewMode>[] = [
  { value: 'readable', label: 'Readable' },
  { value: 'edit', label: 'Edit' },
  { value: 'raw', label: 'Raw' },
]

function rawChange(change: KnowledgeReviewChange): string {
  return [
    `Path: ${change.kbPath}`,
    `Operation: ${change.operation}`,
    '',
    '--- Base ---',
    change.baseContent ?? '(file did not exist)',
    '',
    '--- Current ---',
    change.actualContent ?? change.baseContent ?? '(file did not exist)',
    '',
    '--- Proposed ---',
    change.proposedContent || '(delete file)',
  ].join('\n')
}

export function KnowledgeReviewList({ onApplied, onChanged, refreshKey = 0, slug }: KnowledgeReviewListProps) {
  const [changes, setChanges] = useState<KnowledgeReviewChange[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState<string | null>(null)
  const [modeByChange, setModeByChange] = useState<Record<string, ViewMode>>({})

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/learning`, { cache: 'no-store' })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok || !isLearningResponse(data)) {
        setError(responseError(data, 'knowledge_review_load_failed'))
        return
      }
      setChanges(data.proposals)
      setError(null)
    } catch {
      setError('knowledge_review_load_failed')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [refresh, refreshKey])

  const submitAction = useCallback(async (changeId: string, action: 'apply' | 'reject' | 'rebase' | 'regenerate', content?: string) => {
    setIsBusy(changeId)
    try {
      const response = await fetch(`/api/u/${slug}/learning/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, proposalId: changeId, content }),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        await refresh()
        setError(responseError(data, 'knowledge_review_action_failed'))
        return
      }
      setError(null)
      if (action === 'apply') await onApplied?.()
      await refresh()
      await onChanged?.()
    } catch {
      setError('knowledge_review_action_failed')
    } finally {
      setIsBusy(null)
    }
  }, [onApplied, onChanged, refresh, slug])

  const saveDraft = useCallback(async (changeId: string, content: string) => {
    const response = await fetch(`/api/u/${slug}/learning/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_draft', proposalId: changeId, content }),
    })
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null)
      setError(responseError(data, 'knowledge_review_draft_failed'))
    }
  }, [slug])

  const openChanges = changes.filter((change) => change.status === 'open' || change.status === 'needs_rebase')

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Knowledge proposals</h3>
        {openChanges.length > 0 ? <span className="text-[11px] text-muted-foreground">{openChanges.length}</span> : null}
      </div>
      {error ? <p className="text-xs text-destructive">{errorLabel(error)}</p> : null}
      {openChanges.length > 0 ? (
        <div className="space-y-3">
          {openChanges.map((change) => {
            const content = drafts[change.id] ?? change.proposedContent
            const mode = modeByChange[change.id] ?? 'readable'
            const isRebase = change.status === 'needs_rebase'
            return (
              <article key={change.id} className="space-y-3 rounded-md border-[0.5px] border-border/20 bg-foreground/[0.015] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{change.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{change.operation} · {change.kbPath} · {Math.round(change.confidence * 100)}%</p>
                  </div>
                  {isRebase ? (
                    <Badge variant="warning" className="shrink-0 px-2 py-0 text-[10px]">Needs rebase</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{change.reason}</p>
                {change.evidence.quote ? <blockquote className="border-l-2 border-primary/30 pl-2 text-xs text-muted-foreground">{change.evidence.quote}</blockquote> : null}
                <SegmentedControl
                  value={mode}
                  onValueChange={(next) => setModeByChange((current) => ({ ...current, [change.id]: next }))}
                  options={VIEW_MODE_OPTIONS}
                />
                {mode === 'readable' ? (
                  <div className="max-h-56 overflow-y-auto rounded-md border-[0.5px] border-border/20 p-3">
                    <MarkdownPreview content={content || '_Delete this file_'} />
                  </div>
                ) : mode === 'edit' ? (
                  <textarea
                    aria-label={`Edit ${change.title}`}
                    className="h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    disabled={isBusy === change.id}
                    value={content}
                    onChange={(event) => {
                      const next = event.currentTarget.value
                      setDrafts((current) => ({ ...current, [change.id]: next }))
                      void saveDraft(change.id, next)
                    }}
                  />
                ) : (
                  <pre className="max-h-56 overflow-auto rounded-md border-[0.5px] border-border/20 bg-muted/20 p-3 text-[11px] leading-relaxed">{rawChange({ ...change, proposedContent: content })}</pre>
                )}
                {isRebase ? (
                  <div className="rounded-md border-[0.5px] border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    Compare the base, current, and proposed content in Raw mode. Edit the proposal, then rebase it on the current file before applying.
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={isBusy !== null} onClick={() => void submitAction(change.id, 'reject')}>Reject</Button>
                  {isRebase ? <Button size="sm" variant="outline" disabled={isBusy !== null} onClick={() => void submitAction(change.id, 'regenerate')}>Regenerate with curator</Button> : null}
                  {isRebase ? <Button size="sm" variant="outline" disabled={isBusy !== null} onClick={() => void submitAction(change.id, 'rebase')}>Use current base</Button> : null}
                  <Button size="sm" disabled={isBusy !== null || isRebase} onClick={() => void submitAction(change.id, 'apply', content)}>{isBusy === change.id ? 'Applying…' : 'Apply to workspace'}</Button>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
      {openChanges.length === 0 ? <p className="text-xs text-muted-foreground">{isLoading ? 'Loading Knowledge proposals…' : 'No knowledge proposals awaiting review.'}</p> : null}
    </section>
  )
}
