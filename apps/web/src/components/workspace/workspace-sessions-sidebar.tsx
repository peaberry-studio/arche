'use client'

import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { Lightning, Plus, SpinnerGap } from '@phosphor-icons/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFlowRunner } from '@/hooks/use-flow-runner'
import type { WorkspaceSession } from '@/lib/opencode/types'
import { hasUnseenFlowResult, isFlowSession } from '@/lib/workspace-session-utils'

import { SessionsPanel } from './sessions-panel'

export type SessionsSidebarKind = 'chats' | 'flows'

type WorkspaceSessionsSidebarProps = {
  slug: string
  kind: SessionsSidebarKind
  sessions: WorkspaceSession[]
  activeSessionId: string | null
  hasMoreSessions: boolean
  isInitialSessionsReady: boolean
  isLoadingMoreSessions: boolean
  sessionsError: string | null
  unseenCompletedSessions: ReadonlySet<string>
  headerActions?: ReactNode
  onCreateSession: () => void
  onLoadMoreSessions: () => Promise<void>
  onMarkFlowRunSeen?: (runId: string) => Promise<void> | void
  onRunFlowComplete?: () => Promise<void> | void
  onSelectSession: (id: string) => void
}

export function WorkspaceSessionsSidebar({
  slug,
  kind,
  sessions,
  activeSessionId,
  hasMoreSessions,
  isInitialSessionsReady,
  isLoadingMoreSessions,
  sessionsError,
  unseenCompletedSessions,
  headerActions,
  onCreateSession,
  onLoadMoreSessions,
  onMarkFlowRunSeen,
  onRunFlowComplete,
  onSelectSession,
}: WorkspaceSessionsSidebarProps) {
  const {
    flows,
    isLoadingFlows,
    runningFlowId,
    runError,
    loadFlows,
    runFlow,
  } = useFlowRunner({ slug, onRunFlowComplete })

  const visibleSessions = useMemo(
    () => sessions.filter((session) => kind === 'flows' ? isFlowSession(session) : !isFlowSession(session)),
    [kind, sessions]
  )

  useEffect(() => {
    if (kind !== 'flows') return
    void loadFlows()
  }, [kind, loadFlows])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId)
      const selectedSession = sessions.find((session) => session.id === sessionId)
      const flow = selectedSession?.flow
      if (flow && hasUnseenFlowResult(selectedSession)) {
        void onMarkFlowRunSeen?.(flow.runId)
      }
    },
    [onMarkFlowRunSeen, onSelectSession, sessions]
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
          <DropdownMenu onOpenChange={(open) => { if (open) void loadFlows() }}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                aria-label="Run flow"
                disabled={Boolean(runningFlowId)}
              >
                {runningFlowId ? (
                  <SpinnerGap size={13} className="animate-spin" />
                ) : (
                  <Plus size={13} weight="bold" />
                )}
                Run flow
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-1.5">
              <DropdownMenuLabel className="px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Flows
              </DropdownMenuLabel>
              {isLoadingFlows ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                  <SpinnerGap size={13} className="animate-spin" />
                  Loading flows...
                </div>
              ) : flows.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-xs text-muted-foreground">No flows yet.</p>
              ) : flows.map((flow) => (
                <DropdownMenuItem
                  key={flow.id}
                  disabled={Boolean(runningFlowId)}
                  onSelect={(event) => {
                    event.preventDefault()
                    void runFlow(flow.id)
                  }}
                  className="items-start gap-2 rounded-lg px-2.5 py-2"
                >
                  <Lightning size={14} weight="bold" className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{flow.name}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{flow.description ?? `${flow.definition.nodes.length} nodes`}</span>
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
        isInitialSessionsReady={isInitialSessionsReady}
        isLoadingMore={isLoadingMoreSessions}
        sessionsError={sessionsError}
        unseenCompletedSessions={unseenCompletedSessions}
        onLoadMore={onLoadMoreSessions}
        onSelectSession={handleSelectSession}
        onCreateSession={onCreateSession}
      />
    </div>
  )
}
