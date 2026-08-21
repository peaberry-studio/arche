'use client'

import { useCallback, type ComponentType, type ReactNode } from 'react'
import { ArrowLineLeft, ArrowLineRight, Compass, Database, GitBranch, Plus } from '@phosphor-icons/react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WorkspaceSession } from '@/lib/opencode/types'
import { hasUnseenFlowResult } from '@/lib/workspace-session-utils'

import type { WorkspaceMode } from './workspace-modes'
import { SessionsPanel } from './sessions-panel'
import { WorkspaceSessionsRail } from './workspace-sessions-rail'

type WorkspaceSidebarProps = {
  activeMode: WorkspaceMode
  activeSessionId: string | null
  accountMenu: (collapsed: boolean) => ReactNode
  hasMoreSessions: boolean
  isCollapsed: boolean
  isInitialSessionsReady: boolean
  isLoadingMoreSessions: boolean
  knowledgePendingCount: number
  macDesktopWindowInset?: boolean
  onCreateSession: () => void
  onLoadMoreSessions: () => Promise<void>
  onMarkFlowRunSeen?: (runId: string) => Promise<void> | void
  onNavExplore: () => void
  onNavFlows: () => void
  onNavKnowledge: () => void
  onSelectSession: (id: string) => void
  onToggleCollapsed: () => void
  sessions: WorkspaceSession[]
  sessionsError: string | null
  unseenCompletedSessions: ReadonlySet<string>
}

type NavButtonProps = {
  active?: boolean
  badgeCount?: number
  icon: ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill'; className?: string }>
  label: string
  onClick: () => void
  iconOnly?: boolean
}

function NavButton({ active = false, badgeCount, icon: Icon, label, onClick, iconOnly = false }: NavButtonProps) {
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0
  const badgeLabel = badgeCount && badgeCount > 99 ? '99+' : String(badgeCount ?? 0)

  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={iconOnly && showBadge ? `${label}, ${badgeCount} pending` : label}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md text-[12px] font-medium transition-colors',
        iconOnly ? 'relative w-8 justify-center px-2' : 'w-full px-2.5',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      )}
    >
      <Icon size={15} weight={active ? 'fill' : 'bold'} className="shrink-0" />
      {!iconOnly ? (
        <>
          <span className="flex-1 text-left leading-none">{label}</span>
          {showBadge ? (
            <span
              aria-label={`${badgeCount} pending`}
              className="flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
            >
              {badgeLabel}
            </span>
          ) : null}
        </>
      ) : (
        showBadge ? (
          <span aria-hidden className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary" />
        ) : null
      )}
    </button>
  )

  if (!iconOnly) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function WorkspaceSidebar({
  activeMode,
  activeSessionId,
  accountMenu,
  hasMoreSessions,
  isCollapsed,
  isInitialSessionsReady,
  isLoadingMoreSessions,
  knowledgePendingCount,
  macDesktopWindowInset = false,
  onCreateSession,
  onLoadMoreSessions,
  onMarkFlowRunSeen,
  onNavExplore,
  onNavFlows,
  onNavKnowledge,
  onSelectSession,
  onToggleCollapsed,
  sessions,
  sessionsError,
  unseenCompletedSessions,
}: WorkspaceSidebarProps) {
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId)
      const session = sessions.find((candidate) => candidate.id === sessionId)
      if (session?.flow && hasUnseenFlowResult(session) && onMarkFlowRunSeen) {
        void onMarkFlowRunSeen(session.flow.runId)
      }
    },
    [onMarkFlowRunSeen, onSelectSession, sessions]
  )

  if (isCollapsed) {
    return (
      <TooltipProvider delayDuration={150}>
        <div className="flex h-full min-h-0 flex-col items-center py-2 text-card-foreground">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="Expand sessions panel"
            title="Expand panel"
          >
            <ArrowLineRight size={13} weight="bold" />
          </button>

          <span className="type-display mt-1 text-sm font-semibold tracking-tight [writing-mode:vertical-rl]">Arche</span>

          <div className="my-2 h-px w-6 bg-border/40" />

          <nav aria-label="Workspace navigation" className="flex w-full flex-col items-center gap-1">
            <NavButton
              active={activeMode === 'explore'}
              icon={Compass}
              iconOnly
              label="Explore"
              onClick={onNavExplore}
            />
            <NavButton
              active={activeMode === 'knowledge'}
              badgeCount={knowledgePendingCount}
              icon={Database}
              iconOnly
              label="Knowledge"
              onClick={onNavKnowledge}
            />
            <NavButton icon={GitBranch} iconOnly label="Flows" onClick={onNavFlows} />
          </nav>

          <div className="my-2 h-px w-6 bg-border/40" />

          <WorkspaceSessionsRail
            sessions={sessions}
            activeSessionId={activeSessionId}
            unseenCompletedSessions={unseenCompletedSessions}
            onSelectSession={handleSelectSession}
            onMarkFlowRunSeen={onMarkFlowRunSeen}
          />

          <div className="mt-auto pt-2">{accountMenu(true)}</div>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-none text-card-foreground">
      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 px-1.5 py-2',
          macDesktopWindowInset && 'desktop-titlebar-drag'
        )}
      >
        <div className="flex min-w-0 items-center gap-2 px-2.5">
          {macDesktopWindowInset ? (
            <div aria-label="macOS traffic lights" className="desktop-titlebar-drag pl-[88px]" />
          ) : null}
          <span className="type-display truncate text-base font-semibold tracking-tight">Arche</span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground',
            macDesktopWindowInset && 'desktop-titlebar-no-drag'
          )}
          aria-label="Collapse sessions panel"
          title="Collapse panel"
        >
          <ArrowLineLeft size={13} weight="bold" />
        </button>
      </div>

      <div className="px-1.5 pb-1.5 pt-1">
        <button
          type="button"
          onClick={onCreateSession}
          className="flex h-8 w-full items-center gap-1.5 rounded-md bg-foreground/10 px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/15"
        >
          <Plus size={13} weight="bold" />
          New chat
        </button>
      </div>

      <nav aria-label="Workspace navigation" className="flex flex-col gap-0.5 px-1.5 pb-2">
        <NavButton
          active={activeMode === 'explore'}
          icon={Compass}
          label="Explore"
          onClick={onNavExplore}
        />
        <NavButton
          active={activeMode === 'knowledge'}
          badgeCount={knowledgePendingCount}
          icon={Database}
          label="Knowledge"
          onClick={onNavKnowledge}
        />
        <NavButton icon={GitBranch} label="Flows" onClick={onNavFlows} />
      </nav>

      <SessionsPanel
        sessions={sessions}
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

      <div className="shrink-0 border-t border-border/40 p-1.5">{accountMenu(false)}</div>
    </div>
  )
}
