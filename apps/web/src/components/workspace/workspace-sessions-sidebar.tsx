'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Lightning, Plus, SpinnerGap } from '@phosphor-icons/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AutopilotTaskListItem } from '@/lib/autopilot/types'
import type { WorkspaceSession } from '@/lib/opencode/types'

import { SessionsPanel } from './sessions-panel'

export type SessionsSidebarKind = 'chats' | 'tasks'

type WorkspaceSessionsSidebarProps = {
  slug: string
  kind: SessionsSidebarKind
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-none text-card-foreground">
      <div className="flex shrink-0 items-center justify-between gap-2 pl-1.5 pr-1.5 py-2">
        {kind === 'chats' ? (
          <button
            type="button"
            onClick={onCreateSession}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="New chat"
          >
            <Plus size={13} weight="bold" />
            New chat
          </button>
        ) : (
          <DropdownMenu onOpenChange={(open) => { if (open) void loadTasks() }}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                aria-label="Run task"
                disabled={Boolean(runningTaskId)}
              >
                {runningTaskId ? (
                  <SpinnerGap size={13} className="animate-spin" />
                ) : (
                  <Plus size={13} weight="bold" />
                )}
                Run task
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
