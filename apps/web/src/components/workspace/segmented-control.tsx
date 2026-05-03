'use client'

import {
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
}

type SegmentedControlProps<T extends string> = {
  value: T
  onValueChange: (next: T) => void
  options: SegmentedControlOption<T>[]
  className?: string
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  const [hasAnimated, setHasAnimated] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const button = buttonRefs.current[value]
    const container = containerRef.current
    if (!button || !container) return

    const containerRect = container.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setIndicator({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
    })
  }, [value, options.length])

  useEffect(() => {
    if (!indicator || hasAnimated) return
    const frame = requestAnimationFrame(() => setHasAnimated(true))
    return () => cancelAnimationFrame(frame)
  }, [indicator, hasAnimated])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative inline-flex h-8 items-center rounded-lg bg-foreground/[0.05] p-0.5 text-[11px]',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 h-7 -translate-y-1/2 rounded-md bg-background',
          indicator ? 'opacity-100' : 'opacity-0',
          hasAnimated && 'transition-[left,width] duration-300 ease-out'
        )}
        style={indicator ? { left: indicator.left, width: indicator.width } : undefined}
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
              'relative z-10 flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors',
              isActive
                ? 'text-foreground/85'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
          >
            {Icon ? <Icon size={12} weight={isActive ? 'fill' : 'bold'} /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
