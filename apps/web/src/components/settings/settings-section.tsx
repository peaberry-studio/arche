import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SettingsSectionProps = {
  title: string
  description?: string
  action?: ReactNode
  headingLevel?: 'h2' | 'h3'
  className?: string
  children: ReactNode
}

export function SettingsSection({
  title,
  description,
  action,
  headingLevel = 'h2',
  className,
  children,
}: SettingsSectionProps) {
  const Heading = headingLevel

  return (
    <section
      className={cn(
        'space-y-4 rounded-lg border border-border/60 bg-card/50 p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Heading className="text-lg font-medium">{title}</Heading>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>

      {children}
    </section>
  )
}
