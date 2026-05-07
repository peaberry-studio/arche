'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WorkspaceSession } from '@/lib/opencode/types'

const ROW_HEIGHT = 22
const FADE_END_INDEX = 6
const FADE_RADIUS_PX = ROW_HEIGHT * FADE_END_INDEX
const DOT_RENDER_SIZE = 18
const MAX_DOT_SIZE = 8
const MIN_DOT_SIZE = 3
const MAX_DOT_SCALE = 2.1
const MAX_DOT_GAP_EXTRA = 5

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

function easeFocusFactor(factor: number): number {
  return factor * factor * (3 - 2 * factor)
}

function getDotSpacingOffset(anchorY: number, index: number): number {
  const dotCenterY = index * ROW_HEIGHT + ROW_HEIGHT / 2
  const distance = dotCenterY - anchorY
  const normalizedDistance = Math.min(Math.abs(distance) / FADE_RADIUS_PX, 1)
  const offsetMagnitude =
    (MAX_DOT_GAP_EXTRA * FADE_END_INDEX * (1 - (1 - normalizedDistance) ** 3)) / 3

  return Math.sign(distance) * offsetMagnitude
}

function getRailAnchorY(activeIndex: number): number {
  return activeIndex >= 0 ? activeIndex * ROW_HEIGHT + ROW_HEIGHT / 2 : ROW_HEIGHT / 2
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
  const buttonElsRef = useRef<Map<string, HTMLButtonElement>>(new Map())
  const cursorYRef = useRef<number | null>(null)
  const dotElsRef = useRef<Map<string, HTMLSpanElement>>(new Map())
  const frameRef = useRef<number | null>(null)
  const pointerStrengthRef = useRef(0)
  const [hoveredIndex, setHoveredIndex] = useState(-1)

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

  const applyRailStyles = useCallback(
    (anchorY: number, pointerStrength: number) => {
      visibleSessions.forEach((session, index) => {
        const dotCenterY = index * ROW_HEIGHT + ROW_HEIGHT / 2
        const distance = Math.abs(anchorY - dotCenterY)
        const f = focusFactor(distance)
        const hoverFactor = f * pointerStrength
        const easedHoverFactor = easeFocusFactor(hoverFactor)
        const baseSize = MIN_DOT_SIZE + (MAX_DOT_SIZE - MIN_DOT_SIZE) * f
        const scale = (baseSize * (1 + (MAX_DOT_SCALE - 1) * easedHoverFactor)) / DOT_RENDER_SIZE
        const offsetY = getDotSpacingOffset(anchorY, index) * pointerStrength
        const opacity = session.id === activeSessionId ? 1 : f

        const buttonEl = buttonElsRef.current.get(session.id)
        if (buttonEl) buttonEl.style.opacity = String(opacity)

        const dotEl = dotElsRef.current.get(session.id)
        if (dotEl) dotEl.style.transform = `translate3d(0, ${offsetY}px, 0) scale(${scale})`
      })
    },
    [activeSessionId, visibleSessions]
  )

  const scheduleRailUpdate = useCallback(
    (nextCursorY: number | null) => {
      cursorYRef.current = nextCursorY
      if (frameRef.current !== null) return

      const updateFrame = () => {
        frameRef.current = null
        const cursorY = cursorYRef.current
        const targetStrength = cursorY === null ? 0 : 1
        const nextStrength = pointerStrengthRef.current + (targetStrength - pointerStrengthRef.current) * 0.28
        const pointerStrength = Math.abs(nextStrength - targetStrength) < 0.01 ? targetStrength : nextStrength
        const restAnchorY = getRailAnchorY(activeIndex)
        const pointerAnchorY = cursorY ?? restAnchorY
        const anchorY = restAnchorY + (pointerAnchorY - restAnchorY) * pointerStrength
        const nextHoveredIndex = cursorY !== null && pointerStrength > 0.2
          ? Math.max(0, Math.min(visibleSessions.length - 1, Math.floor(cursorY / ROW_HEIGHT)))
          : -1

        pointerStrengthRef.current = pointerStrength
        applyRailStyles(anchorY, pointerStrength)
        setHoveredIndex((current) => (current === nextHoveredIndex ? current : nextHoveredIndex))

        if (pointerStrength !== targetStrength) {
          frameRef.current = requestAnimationFrame(updateFrame)
        }
      }

      frameRef.current = requestAnimationFrame(updateFrame)
    },
    [activeIndex, applyRailStyles, visibleSessions.length]
  )

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const node = containerRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    scheduleRailUpdate(event.clientY - rect.top + node.scrollTop)
  }, [scheduleRailUpdate])

  const handleMouseLeave = useCallback(() => {
    scheduleRailUpdate(null)
  }, [scheduleRailUpdate])

  useLayoutEffect(() => {
    applyRailStyles(getRailAnchorY(activeIndex), 0)
  }, [activeIndex, applyRailStyles])

  useLayoutEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  if (visibleSessions.length === 0) return null

  return (
    <TooltipProvider delayDuration={150}>
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="flex w-full min-h-0 flex-1 flex-col items-center overflow-hidden"
        aria-label={kind === 'tasks' ? 'Tasks' : 'Chats'}
      >
        {visibleSessions.map((session, index) => {
          const isActive = session.id === activeSessionId
          const isHovered = index === hoveredIndex

          const colorCls = isHovered || isActive
            ? 'bg-primary'
            : dotColorClass(session, unseenCompletedSessions)
          const title =
            kind === 'tasks' && session.autopilot ? session.autopilot.taskName : session.title

          return (
            <Tooltip key={session.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) buttonElsRef.current.set(session.id, el)
                    else buttonElsRef.current.delete(session.id)
                  }}
                  onClick={() => handleSelect(session)}
                  aria-label={title}
                  aria-current={isActive ? 'true' : undefined}
                  style={{ height: ROW_HEIGHT }}
                  className="flex w-full shrink-0 items-center justify-center transition-opacity duration-200 ease-out"
                >
                  <span
                    ref={(el) => {
                      if (el) dotElsRef.current.set(session.id, el)
                      else dotElsRef.current.delete(session.id)
                    }}
                    className={cn(
                      'block rounded-full transform-gpu transition-colors duration-150 ease-out will-change-transform',
                      hoveredIndex < 0 && 'transition-transform duration-200 ease-out',
                      colorCls
                    )}
                    style={{
                      width: DOT_RENDER_SIZE,
                      height: DOT_RENDER_SIZE,
                    }}
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
