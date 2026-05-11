'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'checked' | 'onChange'>

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, className, ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      role="switch"
      type="button"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow-sm ring-0 transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
)
Switch.displayName = 'Switch'

export { Switch }
