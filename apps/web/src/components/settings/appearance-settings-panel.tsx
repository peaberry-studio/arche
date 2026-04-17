'use client'

import { Moon, Sun } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import { cn } from '@/lib/utils'

export function AppearanceSettingsPanel() {
  const {
    themes,
    themeId,
    setThemeId,
    isDark,
    toggleDark,
    chatFontFamily,
    setChatFontFamily,
    chatFontSize,
    canIncreaseChatFontSize,
    canDecreaseChatFontSize,
    increaseChatFontSize,
    decreaseChatFontSize,
  } = useWorkspaceTheme()

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Control how this vault looks inside the desktop workspace.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Theme</p>
        <div className="flex flex-wrap items-center gap-3">
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => setThemeId(theme.id)}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all',
                themeId === theme.id
                  ? 'scale-110 border-foreground'
                  : 'border-transparent hover:scale-105',
              )}
              aria-label={theme.name}
              title={theme.name}
            >
              <div className="h-7 w-7 rounded-full" style={{ backgroundColor: theme.swatch }} />
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Dark mode</p>
        <Button type="button" variant="outline" onClick={toggleDark} className="gap-2">
          {isDark ? <Sun size={16} weight="bold" /> : <Moon size={16} weight="bold" />}
          {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        </Button>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Chat font family</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={chatFontFamily === 'sans' ? 'secondary' : 'outline'}
            onClick={() => setChatFontFamily('sans')}
          >
            Sans
          </Button>
          <Button
            type="button"
            variant={chatFontFamily === 'serif' ? 'secondary' : 'outline'}
            onClick={() => setChatFontFamily('serif')}
          >
            Serif
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">Chat font size</p>
          <span className="text-sm text-foreground">{chatFontSize}px</span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={decreaseChatFontSize}
            disabled={!canDecreaseChatFontSize}
          >
            Smaller
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={increaseChatFontSize}
            disabled={!canIncreaseChatFontSize}
          >
            Larger
          </Button>
        </div>
      </div>
    </section>
  )
}
