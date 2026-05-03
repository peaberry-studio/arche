'use client'

import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type IconComponent = ComponentType<{
  size?: number
  weight?: 'regular' | 'bold' | 'fill' | 'duotone'
  className?: string
}>

type EmptyStateAction =
  | { label: string; href: string; onClick?: never }
  | { label: string; href?: never; onClick: () => void }

type DashboardEmptyStateProps = {
  icon: IconComponent
  title: string
  description: ReactNode
  primaryAction?: EmptyStateAction
  secondaryAction?: EmptyStateAction
}

export function DashboardEmptyState({
  icon: IconComponent,
  title,
  description,
  primaryAction,
  secondaryAction,
}: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <IconComponent size={28} weight="duotone" className="text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {primaryAction || secondaryAction ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {primaryAction ? (
            primaryAction.href ? (
              <Button asChild>
                <Link href={primaryAction.href}>{primaryAction.label}</Link>
              </Button>
            ) : (
              <Button onClick={primaryAction.onClick}>{primaryAction.label}</Button>
            )
          ) : null}
          {secondaryAction ? (
            secondaryAction.href ? (
              <Button variant="outline" asChild>
                <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
