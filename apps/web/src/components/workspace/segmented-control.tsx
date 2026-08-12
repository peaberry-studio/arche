'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react'

import { cn } from '@/lib/utils'

type IconComponent = ComponentType<{
  size?: number
  weight?: 'regular' | 'bold' | 'fill'
}>

export type SegmentedControlOption<T extends string> = {
  value: T
  label: string
  icon?: IconComponent
  badge?: number
}

type SegmentedControlProps<T extends string> = {
  value: T | null
  onValueChange: (next: T) => void
  options: SegmentedControlOption<T>[]
  className?: string
  variant?: 'default' | 'accent' | 'minimal' | 'outline'
  size?: 'default' | 'sm'
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  variant = 'default',
  size = 'default',
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  const [hasAnimated, setHasAnimated] = useState(false)

  const measure = useCallback(() => {
    if (value === null) {
      setIndicator(null)
      return
    }
    const button = buttonRefs.current[value]
    const container = containerRef.current
    if (!button || !container) return

    const containerRect = container.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    if (buttonRect.width === 0) {
      setIndicator(null)
      return
    }
    setIndicator({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
    })
  }, [value])

  useIsomorphicLayoutEffect(measure, [measure, options.length])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    for (const button of Object.values(buttonRefs.current)) {
      if (button) observer.observe(button)
    }
    return () => observer.disconnect()
  }, [measure, options.length])

  useEffect(() => {
    if (!indicator || hasAnimated) return
    const frame = requestAnimationFrame(() => setHasAnimated(true))
    return () => cancelAnimationFrame(frame)
  }, [indicator, hasAnimated])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative inline-flex items-center gap-0.5',
        variant === 'minimal'
          ? 'rounded-lg bg-transparent p-0.5'
          : variant === 'outline'
            ? 'rounded-md border border-border/30 bg-foreground/[0.04] p-[2px]'
            : 'rounded-lg bg-foreground/[0.05] p-1',
        variant !== 'outline' && size === 'sm' ? 'text-[10px]' : 'text-[11px]',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute',
          variant === 'minimal'
            ? 'bottom-0 h-0.5 rounded-full bg-foreground/60'
            : cn(
                'top-1/2 -translate-y-1/2',
                variant === 'outline' ? 'h-6 rounded' : cn('rounded-md', size === 'sm' ? 'h-6' : 'h-7'),
                variant === 'accent'
                  ? 'bg-primary/20 ring-1 ring-inset ring-primary/25'
                  : variant === 'outline'
                    ? 'bg-background shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
                    : 'bg-background'
              ),
          indicator ? 'opacity-100' : 'opacity-0',
          hasAnimated && 'transition-[left,width] duration-300 ease-out'
        )}
        style={indicator
          ? variant === 'minimal'
            ? { left: indicator.left + indicator.width * 0.25, width: indicator.width * 0.5 }
            : { left: indicator.left, width: indicator.width }
          : undefined}
      />
      {options.map((option) => {
        const isActive = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[option.value] = node
            }}
            type="button"
            onClick={() => onValueChange(option.value)}
            aria-pressed={isActive}
            className={cn(
              'relative z-10 flex items-center gap-1.5 font-medium transition-colors',
              variant === 'outline' ? 'h-6 rounded px-2' : cn('rounded-md', size === 'sm' ? 'h-6 px-2.5' : 'h-7 px-3'),
              isActive
                ? variant === 'accent'
                  ? 'text-primary'
                  : variant === 'minimal'
                    ? 'font-semibold text-foreground'
                    : variant === 'outline'
                      ? 'text-foreground'
                      : 'text-foreground/85'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
          >
            {Icon ? <Icon size={12} weight={isActive ? 'fill' : 'bold'} /> : null}
            {option.label}
            {typeof option.badge === 'number' && option.badge > 0 ? (
              <span
                className={cn(
                  'inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
                  isActive
                    ? variant === 'accent'
                      ? 'bg-primary/25 text-primary'
                      : 'bg-primary/15 text-primary'
                    : 'bg-foreground/[0.07] text-muted-foreground'
                )}
              >
                {option.badge > 99 ? '99+' : option.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
