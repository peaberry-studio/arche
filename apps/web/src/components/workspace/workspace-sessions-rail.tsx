'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WorkspaceSession } from '@/lib/opencode/types'

const ROW_HEIGHT = 22
const FADE_END_INDEX = 6
const FADE_RADIUS_PX = ROW_HEIGHT * FADE_END_INDEX
const MAX_DOT_SIZE = 8
const MIN_DOT_SIZE = 3
const MAX_DOT_SCALE = 2.1
const MAX_ROW_EXTRA_HEIGHT = 12

type Kind = 'chats' | 'tasks'

type WorkspaceSessionsRailProps = {
  kind: Kind
  sessions: WorkspaceSession[]
  activeSessionId: string | null
  unseenCompletedSessions: ReadonlySet<string>
  onSelectSession: (id: string) => void
  onMarkAutopilotRunSeen?: (runId: string) => Promise<void> | void
}

function dotColorClass(session: WorkspaceSession, unseen: ReadonlySet<string>): string {
  if (session.status === 'busy') return 'bg-amber-400'
  if (session.status === 'error') return 'bg-red-400'
  if (session.autopilot?.hasUnseenResult) return 'bg-green-400'
  if (unseen.has(session.id)) return 'bg-green-400'
  return 'bg-muted-foreground'
}

function focusFactor(distancePx: number): number {
  if (distancePx <= 0) return 1
  if (distancePx >= FADE_RADIUS_PX) return 0
  return 1 - distancePx / FADE_RADIUS_PX
}

export function WorkspaceSessionsRail({
  kind,
  sessions,
  activeSessionId,
  unseenCompletedSessions,
  onSelectSession,
  onMarkAutopilotRunSeen,
}: WorkspaceSessionsRailProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cursorY, setCursorY] = useState<number | null>(null)

  const visibleSessions = useMemo(
    () =>
      sessions.filter((session) =>
        kind === 'tasks' ? Boolean(session.autopilot) : !session.autopilot
      ),
    [kind, sessions]
  )

  const activeIndex = useMemo(() => {
    if (!activeSessionId) return -1
    return visibleSessions.findIndex((session) => session.id === activeSessionId)
  }, [activeSessionId, visibleSessions])

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const node = containerRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setCursorY(event.clientY - rect.top + node.scrollTop)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setCursorY(null)
  }, [])

  const handleSelect = useCallback(
    (session: WorkspaceSession) => {
      onSelectSession(session.id)
      const autopilot = session.autopilot
      if (autopilot?.hasUnseenResult && onMarkAutopilotRunSeen) {
        void onMarkAutopilotRunSeen(autopilot.runId)
      }
    },
    [onMarkAutopilotRunSeen, onSelectSession]
  )

  if (visibleSessions.length === 0) return null

  const anchorY =
    cursorY !== null
      ? cursorY
      : activeIndex >= 0
        ? activeIndex * ROW_HEIGHT + ROW_HEIGHT / 2
        : ROW_HEIGHT / 2

  return (
    <TooltipProvider delayDuration={150}>
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="flex w-8 min-h-0 flex-1 flex-col items-center overflow-hidden"
        aria-label={kind === 'tasks' ? 'Tasks' : 'Chats'}
      >
        {visibleSessions.map((session, index) => {
          const dotCenterY = index * ROW_HEIGHT + ROW_HEIGHT / 2
          const isActive = session.id === activeSessionId
          const distance = Math.abs(anchorY - dotCenterY)
          const f = focusFactor(distance)
          const hoverFactor = cursorY === null ? 0 : f
          const easedHoverFactor = hoverFactor * hoverFactor * (3 - 2 * hoverFactor)
          const scale = 1 + (MAX_DOT_SCALE - 1) * easedHoverFactor
          const rowHeight = ROW_HEIGHT + MAX_ROW_EXTRA_HEIGHT * easedHoverFactor

          let opacity = f
          let size = MIN_DOT_SIZE + (MAX_DOT_SIZE - MIN_DOT_SIZE) * f

          if (isActive) {
            opacity = 1
            size = MAX_DOT_SIZE
          }

          const colorCls = isActive ? 'bg-primary' : dotColorClass(session, unseenCompletedSessions)
          const title =
            kind === 'tasks' && session.autopilot ? session.autopilot.taskName : session.title

          return (
            <Tooltip key={session.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => handleSelect(session)}
                  aria-label={title}
                  aria-current={isActive ? 'true' : undefined}
                  style={{ height: rowHeight, opacity }}
                  className="flex w-full shrink-0 items-center justify-center transition-[height,opacity] duration-200 ease-out"
                >
                  <span
                    className={cn(
                      'block rounded-full transition-[width,height,transform] duration-200 ease-out will-change-transform',
                      colorCls
                    )}
                    style={{ width: size, height: size, transform: `translateZ(0) scale(${scale})` }}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className="max-w-[340px] rounded-xl px-3 py-2 text-sm leading-snug shadow-lg">
                {title}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
