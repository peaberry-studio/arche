'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CaretDown, Lightning, Plus, SpinnerGap } from '@phosphor-icons/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AutopilotTaskListItem } from '@/lib/autopilot/types'
import type { WorkspaceSession } from '@/lib/opencode/types'
import { cn } from '@/lib/utils'

import { SessionsPanel } from './sessions-panel'

type WorkspaceSessionsSidebarProps = {
  slug: string
  kind: 'chats' | 'tasks'
  sessions: WorkspaceSession[]
  activeSessionId: string | null
  hasMoreSessions: boolean
  isLoadingMoreSessions: boolean
  unseenCompletedSessions: ReadonlySet<string>
  headerActions?: ReactNode
  onCreateSession: () => void
  onLoadMoreSessions: () => Promise<void>
  onMarkAutopilotRunSeen?: (runId: string) => Promise<void> | void
  onRunTaskComplete?: () => Promise<void> | void
  onSelectSession: (id: string) => void
}

const ACTION_BUTTON_CLASSES = cn(
  'inline-flex items-center gap-1 text-[13px] font-medium text-foreground/70 transition-colors',
  'hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
  'disabled:cursor-not-allowed disabled:opacity-60'
)

export function WorkspaceSessionsSidebar({
  slug,
  kind,
  sessions,
  activeSessionId,
  hasMoreSessions,
  isLoadingMoreSessions,
  unseenCompletedSessions,
  headerActions,
  onCreateSession,
  onLoadMoreSessions,
  onMarkAutopilotRunSeen,
  onRunTaskComplete,
  onSelectSession,
}: WorkspaceSessionsSidebarProps) {
  const [tasks, setTasks] = useState<AutopilotTaskListItem[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const visibleSessions = useMemo(
    () => sessions.filter((session) => kind === 'tasks' ? Boolean(session.autopilot) : !session.autopilot),
    [kind, sessions]
  )

  const loadTasks = useCallback(async () => {
    setIsLoadingTasks(true)
    setRunError(null)

    try {
      const response = await fetch(`/api/u/${slug}/autopilot`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as { tasks?: AutopilotTaskListItem[]; error?: string } | null
      if (!response.ok || !data?.tasks) {
        setRunError(data?.error ?? 'load_failed')
        return
      }

      setTasks(data.tasks)
    } catch {
      setRunError('network_error')
    } finally {
      setIsLoadingTasks(false)
    }
  }, [slug])

  useEffect(() => {
    if (kind !== 'tasks') return
    void loadTasks()
  }, [kind, loadTasks])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId)
      const selectedSession = sessions.find((session) => session.id === sessionId)
      const autopilot = selectedSession?.autopilot
      if (autopilot?.hasUnseenResult) {
        void onMarkAutopilotRunSeen?.(autopilot.runId)
      }
    },
    [onMarkAutopilotRunSeen, onSelectSession, sessions]
  )

  const handleRunTask = useCallback(
    async (taskId: string) => {
      setRunningTaskId(taskId)
      setRunError(null)

      try {
        const response = await fetch(`/api/u/${slug}/autopilot/${taskId}/run`, {
          method: 'POST',
        })

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null
          setRunError(data?.error ?? 'run_failed')
          return
        }

        await onRunTaskComplete?.()
        await loadTasks()
      } catch {
        setRunError('network_error')
      } finally {
        setRunningTaskId(null)
      }
    },
    [loadTasks, onRunTaskComplete, slug]
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-foreground/[0.03] text-card-foreground">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/30 px-2 py-2">
        {kind === 'chats' ? (
          <button
            type="button"
            onClick={onCreateSession}
            className={ACTION_BUTTON_CLASSES}
            aria-label="New chat"
          >
            <Plus size={13} weight="bold" className="text-foreground/60" />
            <span>New chat</span>
          </button>
        ) : (
          <DropdownMenu onOpenChange={(open) => { if (open) void loadTasks() }}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={ACTION_BUTTON_CLASSES}
                aria-label="Run"
                disabled={Boolean(runningTaskId)}
              >
              {runningTaskId ? (
                <SpinnerGap size={13} className="animate-spin text-foreground/60" />
              ) : (
                <Lightning size={13} weight="bold" className="text-foreground/60" />
              )}
              <span>Run</span>
              <CaretDown size={11} weight="bold" className="text-foreground/40" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-1.5">
              <DropdownMenuLabel className="px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Autopilot tasks
              </DropdownMenuLabel>
              {isLoadingTasks ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                  <SpinnerGap size={13} className="animate-spin" />
                  Loading tasks...
                </div>
              ) : tasks.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-xs text-muted-foreground">No autopilot tasks yet.</p>
              ) : tasks.map((task) => (
                <DropdownMenuItem
                  key={task.id}
                  disabled={Boolean(runningTaskId)}
                  onSelect={(event) => {
                    event.preventDefault()
                    void handleRunTask(task.id)
                  }}
                  className="items-start gap-2 rounded-lg px-2.5 py-2"
                >
                  <Lightning size={14} weight="bold" className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{task.name}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{task.prompt}</span>
                  </span>
                </DropdownMenuItem>
              ))}
              {runError ? <p className="px-2.5 py-2 text-xs text-destructive">{runError}</p> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {headerActions ? (
          <div className="flex shrink-0 items-center">{headerActions}</div>
        ) : null}
      </div>

      <SessionsPanel
        kind={kind}
        sessions={visibleSessions}
        activeSessionId={activeSessionId}
        hasMore={hasMoreSessions}
        isLoadingMore={isLoadingMoreSessions}
        unseenCompletedSessions={unseenCompletedSessions}
        onLoadMore={onLoadMoreSessions}
        onSelectSession={handleSelectSession}
        onCreateSession={onCreateSession}
      />
    </div>
  )
}
