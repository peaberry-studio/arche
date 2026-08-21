'use client'

import { useCallback, useEffect, useState } from 'react'

import { Tray } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DiffViewer } from '@/components/ui/diff-viewer'
import { MarkdownEditor } from '@/components/workspace/markdown-editor'
import { MarkdownPreview } from '@/components/workspace/markdown-preview'
import { SegmentedControl, type SegmentedControlOption } from '@/components/workspace/segmented-control'
import { useEditorDrafts } from '@/hooks/use-editor-drafts'
import { createUnifiedDiff } from '@/lib/line-diff'
import { cn } from '@/lib/utils'
import type {
  KnowledgeReviewChange,
  KnowledgeReviewOperation,
  LearningRun,
  LearningRunStatus,
} from '@/types/learning'

type KnowledgeReviewListProps = {
  internalLinkPaths?: string[]
  onApplied?: () => void | Promise<void>
  onOpenCountChange?: (count: number) => void
  onOpenFile?: (path: string) => void
  onOpenProposal?: (change: KnowledgeReviewChange, content: string) => void
  refreshKey?: number
  slug: string
}

type LearningResponse = {
  proposals: KnowledgeReviewChange[]
  runs: LearningRun[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isLearningResponse(value: unknown): value is LearningResponse {
  return isRecord(value) && Array.isArray(value.proposals) && Array.isArray(value.runs)
}

function responseError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string' ? value.error : fallback
}

const ERROR_LABELS: Record<string, string> = {
  needs_rebase: 'The target file changed. Rebase the proposal before applying it.',
  not_found: 'Knowledge proposal not found.',
  not_open: 'This Knowledge proposal is no longer open.',
  not_rebaseable: 'This Knowledge proposal cannot be rebased.',
  regeneration_source_not_rebaseable: 'This proposal changed while it was being regenerated. Review it again.',
  file_exists: 'A file already exists at this path.',
  workspace_agent_unavailable: 'Start the workspace to apply this change.',
  invalid_request: 'The request was invalid.',
  knowledge_review_load_failed: 'Could not load Knowledge proposals.',
  knowledge_review_action_failed: 'The action failed. Try again.',
  knowledge_review_draft_failed: 'Could not save your edit. Try again.',
  run_not_cancelable: 'This curator run can no longer be cancelled.',
  run_not_retryable: 'This curator run is already executing.',
  cancel_failed: 'Could not cancel the curator run. Try again.',
  instance_unavailable: 'The workspace instance is unavailable. Try again later.',
}

function errorLabel(error: string): string {
  return ERROR_LABELS[error] ?? error
}

const ACTIVE_RUN_POLL_INTERVAL_MS = 5_000
const IDLE_POLL_INTERVAL_MS = 45_000
// Dispatch happens right after a run is created, so a run still pending after
// this window lost its executor (e.g. a server restart) and can be retried.
const STALE_PENDING_RUN_MS = 2 * 60 * 1000

const RUN_STATUS_LABELS: Record<LearningRunStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const RUN_STATUS_CLASSES: Record<LearningRunStatus, string> = {
  pending: 'bg-muted/60 text-muted-foreground',
  running: 'bg-primary/15 text-primary',
  succeeded: 'bg-emerald-500/15 text-emerald-500',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted/60 text-muted-foreground',
}

function isRunActive(run: LearningRun): boolean {
  return run.status === 'pending' || run.status === 'running'
}

function RunStatusBadge({ status }: { status: LearningRunStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
        RUN_STATUS_CLASSES[status] ?? RUN_STATUS_CLASSES.pending,
      )}
    >
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  )
}

// The panel these panes live in is often much shorter than the viewport, so a
// fixed viewport-relative height overflowed it and forced a nested scrollbar.
// Scrollable panes grow with their content up to a cap; the editor needs a
// definite height, clamped so it stays usable on short and tall viewports.
const VIEW_PANE_SCROLL_CLASS = 'max-h-[60vh] min-h-[8rem]'
const VIEW_PANE_EDITOR_CLASS = 'h-[clamp(18rem,60vh,45rem)]'

type ViewMode = 'readable' | 'edit' | 'raw'

const VIEW_MODE_OPTIONS: SegmentedControlOption<ViewMode>[] = [
  { value: 'readable', label: 'Preview' },
  { value: 'edit', label: 'Edit' },
  { value: 'raw', label: 'Raw' },
]

const GENERIC_REASON = 'Proposed by the knowledge curator.'

const OPERATION_BADGE_VARIANTS: Record<KnowledgeReviewOperation, 'success' | 'default' | 'warning'> = {
  create: 'success',
  update: 'default',
  delete: 'warning',
}

function formatAuthor(author: string): string {
  return author
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function KnowledgeReviewList({
  internalLinkPaths,
  onApplied,
  onOpenCountChange,
  onOpenFile,
  onOpenProposal,
  refreshKey = 0,
  slug,
}: KnowledgeReviewListProps) {
  const [changes, setChanges] = useState<KnowledgeReviewChange[]>([])
  const [runs, setRuns] = useState<LearningRun[]>([])
  const [refreshedAt, setRefreshedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState<string | null>(null)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)
  const [modeByChange, setModeByChange] = useState<Record<string, ViewMode | null>>({})

  const { clearDraft, flushDraft, getDraft, getSaveError, getSaveState, handleChange } = useEditorDrafts({
    onSave: async (changeId, content) => {
      try {
        const response = await fetch(`/api/u/${slug}/learning/proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_draft', proposalId: changeId, content }),
        })
        if (!response.ok) {
          const data: unknown = await response.json().catch(() => null)
          return { ok: false, error: errorLabel(responseError(data, 'knowledge_review_draft_failed')) }
        }
        return { ok: true }
      } catch {
        return { ok: false, error: errorLabel('knowledge_review_draft_failed') }
      }
    },
  })

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/learning`, { cache: 'no-store' })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok || !isLearningResponse(data)) {
        setError(responseError(data, 'knowledge_review_load_failed'))
        return
      }
      setChanges(data.proposals)
      setRuns(data.runs)
      setRefreshedAt(Date.now())
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

  const hasActiveRun = runs.some(isRunActive)

  // A curator run writes its proposals when it finishes, so without polling a
  // regeneration started from here never shows up until a manual refresh.
  useEffect(() => {
    const interval = window.setInterval(
      () => { void refresh() },
      hasActiveRun ? ACTIVE_RUN_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS,
    )
    return () => window.clearInterval(interval)
  }, [hasActiveRun, refresh])

  const submitRunAction = useCallback(async (runId: string, action: 'cancel' | 'retry') => {
    setBusyRunId(runId)
    try {
      const response = action === 'cancel'
        ? await fetch(`/api/u/${slug}/learning/runs/${runId}/cancel`, { method: 'POST' })
        : await fetch(`/api/u/${slug}/learning`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
        })
      const data: unknown = await response.json().catch(() => null)
      // Refresh first: a successful reload clears the error state, so setting
      // the message afterwards is what keeps it on screen.
      await refresh()
      if (!response.ok) {
        setError(responseError(data, action === 'cancel' ? 'cancel_failed' : 'knowledge_review_action_failed'))
      }
    } catch {
      setError(action === 'cancel' ? 'cancel_failed' : 'knowledge_review_action_failed')
    } finally {
      setBusyRunId(null)
    }
  }, [refresh, slug])

  const submitAction = useCallback(async (changeId: string, action: 'apply' | 'reject' | 'rebase' | 'regenerate', content?: string) => {
    setIsBusy(changeId)
    try {
      // Rebase and regenerate act on the persisted proposal content. A pending
      // debounced edit must be flushed first so it is not silently dropped by
      // the clearDraft that follows a successful action.
      if (action === 'rebase' || action === 'regenerate') {
        await flushDraft(changeId)
      }
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
      clearDraft(changeId)
      if (action === 'apply') await onApplied?.()
      await refresh()
    } catch {
      setError('knowledge_review_action_failed')
    } finally {
      setIsBusy(null)
    }
  }, [clearDraft, flushDraft, onApplied, refresh, slug])

  const openChanges = changes.filter((change) => change.status === 'open' || change.status === 'needs_rebase')

  useEffect(() => {
    onOpenCountChange?.(openChanges.length)
  }, [onOpenCountChange, openChanges.length])

  // Succeeded and cancelled runs are already represented by the proposals they
  // produced; only runs the user can still act on are worth the space here.
  const actionableRuns = runs.filter((run) => isRunActive(run) || run.status === 'failed')

  const showEmptyState = openChanges.length === 0
  const isFullyEmpty = showEmptyState && actionableRuns.length === 0 && !error

  return (
    <div className={isFullyEmpty ? 'flex min-h-full flex-col' : 'space-y-6'}>
      {error ? <p className="text-xs text-destructive">{errorLabel(error)}</p> : null}
      {actionableRuns.length > 0 ? (
        <section className="space-y-2" aria-label="Curator runs">
          {actionableRuns.map((run) => {
            const isStalePending = run.status === 'pending' && refreshedAt - Date.parse(run.createdAt) > STALE_PENDING_RUN_MS
            const isRetryable = run.status === 'failed' || isStalePending
            return (
              <div key={run.id} className="rounded-md border-[0.5px] border-border/20 bg-foreground/[0.015] px-3 py-2">
                <div className="flex items-center gap-2">
                  <RunStatusBadge status={run.status} />
                  <p className="min-w-0 flex-1 truncate text-xs">{run.title}</p>
                  {isRunActive(run) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 border-border/40 px-2 text-[11px]"
                      disabled={busyRunId !== null}
                      onClick={() => void submitRunAction(run.id, 'cancel')}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  {isRetryable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 border-border/40 px-2 text-[11px]"
                      disabled={busyRunId !== null}
                      onClick={() => void submitRunAction(run.id, 'retry')}
                    >
                      {run.status === 'failed' ? 'Retry' : 'Run now'}
                    </Button>
                  ) : null}
                </div>
                {run.status === 'failed' && run.error ? (
                  <p className="mt-1.5 text-[11px] text-destructive">{errorLabel(run.error)}</p>
                ) : null}
              </div>
            )
          })}
        </section>
      ) : null}
      {openChanges.map((change) => {
        const content = getDraft(change.id, change.proposedContent)
        const mode = modeByChange[change.id] ?? null
        const isRebase = change.status === 'needs_rebase'
        return (
          <article key={change.id} className="overflow-hidden rounded-md border-[0.5px] border-border/20 bg-foreground/[0.015]">
            <div className="p-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {onOpenProposal ? (
                    <button
                      type="button"
                      onClick={() => onOpenProposal(change, content)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary"
                      title={change.title}
                    >
                      {change.title}
                    </button>
                  ) : (
                    <p className="min-w-0 truncate text-sm font-medium">{change.title}</p>
                  )}
                  {isRebase ? (
                    <Badge variant="warning" className="shrink-0 px-2 py-0 text-[10px]">Needs rebase</Badge>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                    by {formatAuthor(change.author)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Badge
                    variant={OPERATION_BADGE_VARIANTS[change.operation]}
                    className="shrink-0 px-1.5 py-0 text-[10px] capitalize"
                  >
                    {change.operation}
                  </Badge>
                  <span className="min-w-0 truncate font-mono text-[10px]" title={change.kbPath}>{change.kbPath}</span>
                  <span className="shrink-0 text-muted-foreground/60">· {Math.round(change.confidence * 100)}%</span>
                </div>
              </div>
              {change.reason && change.reason !== GENERIC_REASON ? (
                <p className="mt-6 text-xs text-muted-foreground">{change.reason}</p>
              ) : null}
              {change.evidence.quote ? (
                <p className="mt-1.5 text-xs text-muted-foreground/80">{change.evidence.quote}</p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-1">
              <SegmentedControl
                size="sm"
                variant="minimal"
                className="-ml-3"
                value={mode}
                onValueChange={(next) => setModeByChange((current) => ({ ...current, [change.id]: next === mode ? null : next }))}
                options={VIEW_MODE_OPTIONS}
              />
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 border-border/40 px-2.5 text-xs" disabled={isBusy !== null} onClick={() => void submitAction(change.id, 'reject')}>Reject</Button>
                {isRebase ? <Button size="sm" variant="outline" className="h-7 border-border/40 px-2.5 text-xs" disabled={isBusy !== null} onClick={() => void submitAction(change.id, 'regenerate')}>Regenerate with curator</Button> : null}
                {isRebase ? <Button size="sm" variant="outline" className="h-7 border-border/40 px-2.5 text-xs" disabled={isBusy !== null} onClick={() => void submitAction(change.id, 'rebase')}>Use current base</Button> : null}
                <Button size="sm" className="h-7 px-2.5 text-xs" disabled={isBusy !== null || isRebase} onClick={() => void submitAction(change.id, 'apply', content)}>{isBusy === change.id ? 'Applying…' : 'Apply'}</Button>
              </div>
            </div>
            {mode !== null ? (
            <div className="border-t border-border/20">
              {mode === 'readable' ? (
                <div className={cn(VIEW_PANE_SCROLL_CLASS, 'overflow-y-auto scrollbar-custom')}>
                  <MarkdownPreview content={content || '_Delete this file_'} />
                </div>
              ) : mode === 'edit' ? (
                <div className={VIEW_PANE_EDITOR_CLASS}>
                  <MarkdownEditor
                    key={change.id}
                    value={content}
                    onChange={(next) => handleChange(change.id, next, change.proposedContent)}
                    saveState={getSaveState(change.id)}
                    saveError={getSaveError(change.id)}
                    internalLinkPaths={internalLinkPaths}
                    onOpenInternalLink={onOpenFile}
                  />
                </div>
              ) : (
                <div className={cn(VIEW_PANE_SCROLL_CLASS, 'overflow-y-auto scrollbar-custom')}>
                  <DiffViewer
                    diff={createUnifiedDiff({
                      oldText: isRebase ? change.actualContent ?? change.baseContent ?? '' : change.baseContent ?? '',
                      newText: content,
                      path: change.kbPath,
                      operation: change.operation,
                    })}
                  />
                </div>
              )}
            </div>
            ) : null}
            {isRebase ? (
              <div className="border-t border-border/20 bg-amber-500/5 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                The file changed since this proposal was created. Raw shows the diff against the current file. Edit the proposal, then rebase it before applying.
              </div>
            ) : null}
          </article>
        )
      })}
      {showEmptyState ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Tray size={28} className="text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">{isLoading ? 'Loading Knowledge proposals…' : 'No knowledge proposals awaiting review.'}</p>
          {isLoading ? null : (
            <p className="max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/70">
              Agent and curator suggestions appear here. They are not on disk until you Apply.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
