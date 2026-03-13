'use client'

import { Moon, Sun } from '@phosphor-icons/react'

import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import { cn } from '@/lib/utils'

export function ThemePicker() {
  const { themes, themeId, setThemeId, isDark, toggleDark } = useWorkspaceTheme()

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">Theme</p>
      <div className="flex items-center gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() => setThemeId(theme.id)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all',
              themeId === theme.id
                ? 'border-foreground scale-110'
                : 'border-transparent hover:scale-105',
            )}
            aria-label={theme.name}
            title={theme.name}
          >
            <div
              className="h-6 w-6 rounded-full"
              style={{ backgroundColor: theme.swatch }}
            />
          </button>
        ))}

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-border/60" />

        {/* Animated sun/moon toggle */}
        <button
          type="button"
          onClick={toggleDark}
          className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-transparent text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          <Sun
            size={18}
            weight="bold"
            className={cn(
              'absolute transition-all duration-300',
              isDark
                ? 'rotate-90 scale-0 opacity-0'
                : 'rotate-0 scale-100 opacity-100',
            )}
          />
          <Moon
            size={18}
            weight="bold"
            className={cn(
              'absolute transition-all duration-300',
              isDark
                ? 'rotate-0 scale-100 opacity-100'
                : '-rotate-90 scale-0 opacity-0',
            )}
          />
        </button>
      </div>
    </div>
  )
}
