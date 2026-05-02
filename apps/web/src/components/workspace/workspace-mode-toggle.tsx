'use client'

import type { ComponentType } from 'react'
import { ChatCircle, Database, Lightning } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'

export type WorkspaceMode = 'chat' | 'knowledge' | 'autopilot'

type WorkspaceModeToggleProps = {
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
  knowledgePendingCount?: number
  className?: string
}

type ModeButtonProps = {
  active: boolean
  badgeCount?: number
  icon: ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill' }>
  label: string
  onClick: () => void
}

function ModeButton({ active, badgeCount, icon: Icon, label, onClick }: ModeButtonProps) {
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0
  const badgeLabel = badgeCount && badgeCount > 99 ? '99+' : String(badgeCount ?? 0)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative flex h-7 items-center gap-1.5 rounded-full px-4 text-[12px] font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      )}
    >
      <Icon size={13} weight={active ? 'fill' : 'bold'} />
      <span className="leading-none">{label}</span>
      {showBadge ? (
        <span
          aria-label={`${badgeCount} pending`}
          className={cn(
            '-mr-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
            active
              ? 'bg-primary-foreground/20 text-primary-foreground'
              : 'bg-primary text-primary-foreground'
          )}
        >
          {badgeLabel}
        </span>
      ) : null}
    </button>
  )
}

export function WorkspaceModeToggle({
  mode,
  onModeChange,
  knowledgePendingCount = 0,
  className,
}: WorkspaceModeToggleProps) {
  return (
    <div
      className={cn(
        'inline-flex h-9 items-center gap-0.5 rounded-full border border-border/40 bg-background/70 p-0.5 shadow-sm backdrop-blur-md',
        className
      )}
    >
      <ModeButton
        active={mode === 'chat'}
        icon={ChatCircle}
        label="Chat"
        onClick={() => onModeChange('chat')}
      />
      <ModeButton
        active={mode === 'knowledge'}
        badgeCount={knowledgePendingCount}
        icon={Database}
        label="Knowledge"
        onClick={() => onModeChange('knowledge')}
      />
      <ModeButton
        active={mode === 'autopilot'}
        icon={Lightning}
        label="Autopilot"
        onClick={() => onModeChange('autopilot')}
      />
    </div>
  )
}
