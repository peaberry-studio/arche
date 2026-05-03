'use client'

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from 'react'
import { ChatCircle, Database, Lightning } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'

export type WorkspaceMode = 'chat' | 'tasks' | 'knowledge'

type WorkspaceModeToggleProps = {
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
  knowledgePendingCount?: number
  hideTasks?: boolean
  className?: string
}

type ModeButtonProps = {
  active: boolean
  badgeCount?: number
  buttonRef: RefObject<HTMLButtonElement | null>
  icon: ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill' }>
  label: string
  onClick: () => void
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

function ModeButton({ active, badgeCount, buttonRef, icon: Icon, label, onClick }: ModeButtonProps) {
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0
  const badgeLabel = badgeCount && badgeCount > 99 ? '99+' : String(badgeCount ?? 0)

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative z-10 flex h-7 items-center gap-1.5 rounded-full px-4 text-[12px] font-medium transition-colors duration-200',
        active
          ? 'text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground'
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
  hideTasks = false,
  className,
}: WorkspaceModeToggleProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLButtonElement>(null)
  const tasksRef = useRef<HTMLButtonElement>(null)
  const knowledgeRef = useRef<HTMLButtonElement>(null)
  const refByMode: Record<WorkspaceMode, RefObject<HTMLButtonElement | null>> = {
    chat: chatRef,
    tasks: tasksRef,
    knowledge: knowledgeRef,
  }

  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  const [hasAnimated, setHasAnimated] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const button = refByMode[mode].current
    const container = containerRef.current
    if (!button || !container) return

    const containerRect = container.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setIndicator({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
    })
  }, [mode])

  useEffect(() => {
    if (!indicator || hasAnimated) return
    const frame = requestAnimationFrame(() => setHasAnimated(true))
    return () => cancelAnimationFrame(frame)
  }, [indicator, hasAnimated])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative inline-flex h-9 items-center gap-0.5 rounded-full border border-border/30 bg-black/[0.05] px-[3px] py-1 dark:bg-black/30',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 h-7 -translate-y-1/2 rounded-full bg-primary shadow-sm',
          indicator ? 'opacity-100' : 'opacity-0',
          hasAnimated && 'transition-[left,width] duration-300 ease-out'
        )}
        style={indicator ? { left: indicator.left, width: indicator.width } : undefined}
      />
      <ModeButton
        active={mode === 'chat'}
        buttonRef={chatRef}
        icon={ChatCircle}
        label="Sessions"
        onClick={() => onModeChange('chat')}
      />
      {hideTasks ? null : (
        <ModeButton
          active={mode === 'tasks'}
          buttonRef={tasksRef}
          icon={Lightning}
          label="Tasks"
          onClick={() => onModeChange('tasks')}
        />
      )}
      <ModeButton
        active={mode === 'knowledge'}
        badgeCount={knowledgePendingCount}
        buttonRef={knowledgeRef}
        icon={Database}
        label="Knowledge"
        onClick={() => onModeChange('knowledge')}
      />
    </div>
  )
}
