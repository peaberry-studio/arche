'use client'

import { type ReactNode } from 'react'

import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import { cn } from '@/lib/utils'

type DashboardThemeShellProps = {
  children: ReactNode
}

export function DashboardThemeShell({ children }: DashboardThemeShellProps) {
  const { theme } = useWorkspaceTheme()
  const themeClassName = `theme-${theme.id}`

  const darkModeClasses = theme.isDark
    ? `dark dark-${theme.darkVariant}`
    : ''

  return (
    <div
      className={cn('relative min-h-screen text-foreground', darkModeClasses, themeClassName)}
      style={{
        backgroundAttachment: 'fixed',
        backgroundImage: theme.gradient,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
      }}
    >
      {/* Subtle dot-grid overlay — fades out towards center */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--grid-line) 0.8px, transparent 0.8px)',
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(0,0,0,0.5) 0%, black 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(0,0,0,0.5) 0%, black 100%)',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
