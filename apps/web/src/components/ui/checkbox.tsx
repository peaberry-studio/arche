'use client'

import * as React from 'react'
import { Check } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <span className={cn('relative inline-flex h-4 w-4 shrink-0', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer h-full w-full cursor-pointer appearance-none rounded border border-border/70 bg-card/60 transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <Check
        weight="bold"
        className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  ),
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
