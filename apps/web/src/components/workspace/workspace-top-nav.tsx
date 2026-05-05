'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CaretDown,
  Cpu,
  GearSix,
  Minus,
  Moon,
  Palette,
  Plugs,
  Plus,
  Sun,
} from '@phosphor-icons/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import type { SyncKbResult } from '@/app/api/instances/[slug]/sync-kb/route'
import { cn } from '@/lib/utils'

import { SyncKbButton } from './sync-kb-button'
import { WorkspaceModeToggle, type WorkspaceMode } from './workspace-mode-toggle'

type ConnectorStatus = 'ready' | 'pending' | 'disabled'

type ConnectorSummary = {
  id: string
  name: string
  type: string
  status: ConnectorStatus
}

type ProviderSummary = {
  providerId: string
  status: 'enabled' | 'disabled' | 'missing'
  type?: string
  version?: number
}

type WorkspaceTopNavProps = {
  slug: string
  mode: WorkspaceMode
  status: 'active' | 'provisioning' | 'offline'
  knowledgePendingCount?: number
  macDesktopWindowInset?: boolean
  hideTasksMode?: boolean
  onModeChange: (mode: WorkspaceMode) => void
  onNavigateConnectors?: () => void
  onNavigateProviders?: () => void
  onNavigateSettings: () => void
  onSyncComplete?: (status: SyncKbResult['status']) => void
}

export function WorkspaceTopNav({
  slug,
  mode,
  status,
  knowledgePendingCount = 0,
  macDesktopWindowInset = false,
  hideTasksMode = false,
  onModeChange,
  onNavigateConnectors,
  onNavigateProviders,
  onNavigateSettings,
  onSyncComplete,
}: WorkspaceTopNavProps) {
  const {
    themes,
    themeId,
    setThemeId,
    isDark,
    toggleDark,
    chatFontFamily,
    setChatFontFamily,
    chatFontSize,
    increaseChatFontSize,
    decreaseChatFontSize,
    canIncreaseChatFontSize,
    canDecreaseChatFontSize,
  } = useWorkspaceTheme()
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([])
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [isLoadingConnectors, setIsLoadingConnectors] = useState(true)
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const themeOptions = themes ?? []

  const loadIntegrations = useCallback(async () => {
    try {
      const [connectorsResponse, providersResponse] = await Promise.all([
        fetch(`/api/u/${slug}/connectors`, { cache: 'no-store' }),
        fetch(`/api/u/${slug}/providers`, { cache: 'no-store' }),
      ])

      if (connectorsResponse.ok) {
        const data = (await connectorsResponse.json().catch(() => null)) as { connectors?: ConnectorSummary[] } | null
        setConnectors(Array.isArray(data?.connectors) ? data.connectors : [])
      }

      if (providersResponse.ok) {
        const data = (await providersResponse.json().catch(() => null)) as { providers?: ProviderSummary[] } | null
        setProviders(Array.isArray(data?.providers) ? data.providers : [])
      }
    } catch {
      // Keep the menu usable when integration status polling fails.
    } finally {
      setIsLoadingConnectors(false)
      setIsLoadingProviders(false)
    }
  }, [slug])

  useEffect(() => {
    void loadIntegrations()
    const interval = setInterval(() => {
      void loadIntegrations()
    }, 30000)

    return () => clearInterval(interval)
  }, [loadIntegrations])

  const activeConnectors = connectors.filter((connector) => connector.status === 'ready').length
  const pendingConnectors = connectors.filter((connector) => connector.status === 'pending').length
  const activeProviders = providers.filter((provider) => provider.status === 'enabled').length

  const connectorDotClass =
    connectors.length === 0
      ? 'bg-muted-foreground/40'
      : pendingConnectors > 0
        ? 'bg-amber-500'
        : activeConnectors === connectors.length
          ? 'bg-emerald-500'
          : 'bg-rose-500'

  const providerDotClass = activeProviders > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40'

  return (
    <header
      className={cn(
        'relative z-30 grid shrink-0 items-center gap-3 border-b border-border/30 bg-background px-4',
        macDesktopWindowInset
          ? 'desktop-titlebar-drag h-[52px] grid-cols-[1fr_auto_1fr] pl-[88px] pt-1.5'
          : 'h-14 grid-cols-[auto_1fr] sm:grid-cols-[1fr_auto_1fr]'
      )}
    >
      {macDesktopWindowInset ? (
        <div className="flex min-w-0 items-center" />
      ) : (
        <div className="hidden min-w-0 items-center sm:flex">
          <span className="type-display truncate text-base font-semibold tracking-tight">Archē</span>
        </div>
      )}

      <WorkspaceModeToggle
        mode={mode}
        onModeChange={onModeChange}
        knowledgePendingCount={knowledgePendingCount}
        hideTasks={hideTasksMode}
        className={cn(macDesktopWindowInset && 'desktop-titlebar-no-drag')}
      />

      <div className="flex min-w-0 justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex min-w-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5',
                macDesktopWindowInset && 'desktop-titlebar-no-drag'
              )}
              aria-label="Workspace account menu"
            >
              <span className="max-w-[6rem] truncate font-medium sm:max-w-none">{slug}</span>
              <CaretDown size={13} weight="bold" className="shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-1.5">
            {onNavigateConnectors ? (
              <DropdownMenuItem onSelect={onNavigateConnectors} className="gap-2 rounded-lg px-2.5 py-2">
                <Plugs size={15} weight="bold" className="text-muted-foreground" />
                <span className="flex-1 text-sm">Connectors</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {isLoadingConnectors ? (
                    <span>…</span>
                  ) : (
                    <>
                      <span className="tabular-nums">{activeConnectors} active</span>
                      <span className={cn('h-1.5 w-1.5 rounded-full', connectorDotClass)} />
                    </>
                  )}
                </span>
              </DropdownMenuItem>
            ) : null}

            {onNavigateProviders ? (
              <DropdownMenuItem onSelect={onNavigateProviders} className="gap-2 rounded-lg px-2.5 py-2">
                <Cpu size={15} weight="bold" className="text-muted-foreground" />
                <span className="flex-1 text-sm">Providers</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {isLoadingProviders ? (
                    <span>…</span>
                  ) : (
                    <>
                      <span className="tabular-nums">{activeProviders} active</span>
                      <span className={cn('h-1.5 w-1.5 rounded-full', providerDotClass)} />
                    </>
                  )}
                </span>
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuSeparator className="my-1.5" />

            {/* Appearance */}
            <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Appearance
            </DropdownMenuLabel>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <Palette size={14} weight="bold" className="mr-1 text-muted-foreground" />
              {themeOptions.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setThemeId(theme.id)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all',
                    themeId === theme.id ? 'border-foreground' : 'border-transparent hover:scale-110'
                  )}
                  aria-label={theme.name}
                  title={theme.name}
                >
                  <div className="h-5 w-5 rounded-full" style={{ backgroundColor: theme.swatch }} />
                </button>
              ))}
              <div className="mx-0.5 h-5 w-px bg-border/60" />
              <button
                type="button"
                onClick={toggleDark}
                className="relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                title={isDark ? 'Light mode' : 'Dark mode'}
              >
                <Sun size={14} weight="bold" className={cn('absolute transition-all duration-300', isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
                <Moon size={14} weight="bold" className={cn('absolute transition-all duration-300', isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 px-2 py-1.5">
              <Button type="button" size="sm" variant={chatFontFamily === 'sans' ? 'secondary' : 'outline'} className="h-8" onClick={() => setChatFontFamily('sans')}>Sans</Button>
              <Button type="button" size="sm" variant={chatFontFamily === 'serif' ? 'secondary' : 'outline'} className="h-8" onClick={() => setChatFontFamily('serif')}>Serif</Button>
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={decreaseChatFontSize} disabled={!canDecreaseChatFontSize} aria-label="Decrease chat font size"><Minus size={14} weight="bold" /></Button>
              <div className="flex-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-center text-xs text-muted-foreground">{chatFontSize}px</div>
              <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={increaseChatFontSize} disabled={!canIncreaseChatFontSize} aria-label="Increase chat font size"><Plus size={14} weight="bold" /></Button>
            </div>

            <DropdownMenuSeparator className="my-2" />

            {/* Workspace actions: Sync KB then Settings (least to most common) */}
            <SyncKbButton
              slug={slug}
              disabled={status !== 'active'}
              onComplete={onSyncComplete}
              renderAs="row"
            />
            <DropdownMenuItem
              onSelect={onNavigateSettings}
              className="gap-2 rounded-lg px-2.5 py-2"
            >
              <GearSix size={15} weight="bold" className="text-muted-foreground" />
              <span>Settings</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
