import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SettingsSectionProps = {
  title: string
  description?: string
  action?: ReactNode
  headingLevel?: 'h2' | 'h3'
  className?: string
  titleClassName?: string
  children: ReactNode
}

export function SettingsSection({
  title,
  description,
  action,
  headingLevel = 'h2',
  className,
  titleClassName,
  children,
}: SettingsSectionProps) {
  const Heading = headingLevel

  return (
    <section className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Heading className={cn('text-lg font-medium', titleClassName)}>{title}</Heading>
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
