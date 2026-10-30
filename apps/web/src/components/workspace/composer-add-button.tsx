'use client'

import type { ComponentPropsWithRef } from 'react'
import { Plus, SpinnerGap } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'

type ComposerAddButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  count?: number
  isBusy?: boolean
  label: string
}

export function ComposerAddButton({ className, count = 0, isBusy = false, label, ...props }: ComposerAddButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50',
        count > 0
          ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
          : 'border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground',
        className,
      )}
      {...props}
    >
      {isBusy ? <SpinnerGap size={16} className="animate-spin" /> : <Plus size={16} weight="bold" />}
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground"
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}
