import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SettingsInfoBoxTone = 'info' | 'success' | 'error'

type SettingsInfoBoxProps = {
  tone?: SettingsInfoBoxTone
  className?: string
  children: ReactNode
}

const TONE_CLASSES: Record<SettingsInfoBoxTone, string> = {
  info: 'rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-muted-foreground',
  success: 'rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-foreground',
  error: 'rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive',
}

export function SettingsInfoBox({ tone = 'info', className, children }: SettingsInfoBoxProps) {
  return <div className={cn(TONE_CLASSES[tone], className)}>{children}</div>
}
