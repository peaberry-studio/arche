'use client'

import type { ReactNode, RefObject } from 'react'

import { cn } from '@/lib/utils'

export const MIN_LEFT_PX = 200
export const MIN_RIGHT_PX = 320
export const COLLAPSED_PANEL_PX = 48 // Width of minified (collapsed) panels
const PANEL_ANIM = '200ms ease-out'
const PANEL_TRANSITION = `width ${PANEL_ANIM}, min-width ${PANEL_ANIM}, opacity ${PANEL_ANIM}, margin ${PANEL_ANIM}, border-width ${PANEL_ANIM}`

type WorkspacePanesProps = {
  centerElement: ReactNode
  containerRef: RefObject<HTMLDivElement | null>
  hasLeftPanel?: boolean
  hasRightPanel: boolean
  isDragging: boolean
  leftCollapsed?: boolean
  leftElement?: ReactNode
  leftWidth?: number
  macDesktopWindowInset?: boolean
  minCenterWidth: number
  minRightWidth?: number
  onResizeLeft?: (event: React.PointerEvent<HTMLDivElement>) => void
  onResizeRight: (event: React.PointerEvent<HTMLDivElement>) => void
  rightCollapsed: boolean
  rightCollapsedWidth?: number
  rightElement: ReactNode
  rightWidth: number
}

export function WorkspacePanes({
  centerElement,
  containerRef,
  hasLeftPanel = true,
  hasRightPanel,
  isDragging,
  leftCollapsed = false,
  leftElement,
  leftWidth = MIN_LEFT_PX,
  macDesktopWindowInset = false,
  minCenterWidth,
  minRightWidth = MIN_RIGHT_PX,
  onResizeLeft,
  onResizeRight,
  rightCollapsed,
  rightCollapsedWidth = COLLAPSED_PANEL_PX,
  rightElement,
  rightWidth,
}: WorkspacePanesProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {macDesktopWindowInset ? (
        <div aria-label="Desktop titlebar drag region" className="desktop-titlebar-drag h-8 shrink-0" />
      ) : null}
      <div ref={containerRef} className="relative z-10 flex min-h-0 flex-1">
        {hasLeftPanel ? (
          <div
            data-testid="panes-left"
            className="shrink-0 overflow-hidden border-r border-border/30"
            style={{
              width: leftCollapsed ? COLLAPSED_PANEL_PX : leftWidth,
              minWidth: leftCollapsed ? COLLAPSED_PANEL_PX : MIN_LEFT_PX,
              opacity: 1,
              transition: isDragging ? 'none' : PANEL_TRANSITION,
            }}
          >
            {leftElement}
          </div>
        ) : null}

        {hasLeftPanel && !leftCollapsed ? (
          <div
            className="absolute bottom-0 top-0 z-20 w-6 cursor-col-resize"
            style={{ left: leftWidth - 3 }}
            onPointerDown={onResizeLeft}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
          />
        ) : null}

        <div
          className="flex min-w-0 flex-1 items-stretch justify-center"
          style={{ minWidth: hasRightPanel ? minCenterWidth : 0 }}
        >
          <div
            data-testid="panes-center"
            className={cn('h-full w-full min-w-0 overflow-hidden', hasRightPanel && 'border-r border-border/30')}
          >
            {centerElement}
          </div>
        </div>

        {hasRightPanel && !rightCollapsed ? (
          <div
            className="absolute bottom-0 top-0 z-20 w-6 cursor-col-resize"
            style={{ right: rightWidth - 3 }}
            onPointerDown={onResizeRight}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
          />
        ) : null}

        {hasRightPanel ? (
          <div
            data-testid="panes-right"
            className="box-border shrink-0 overflow-hidden"
            style={{
              width: rightCollapsed ? rightCollapsedWidth : rightWidth,
              minWidth: rightCollapsed ? rightCollapsedWidth : minRightWidth,
              opacity: 1,
              transition: isDragging ? 'none' : PANEL_TRANSITION,
            }}
          >
            {rightElement}
          </div>
        ) : null}
      </div>
    </div>
  )
}
