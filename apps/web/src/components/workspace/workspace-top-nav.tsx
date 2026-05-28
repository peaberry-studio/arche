'use client'

import { useEffect, useState } from 'react'
import {
  CaretDown,
  Cpu,
  FolderOpen,
  GearSix,
  Minus,
  Moon,
  Palette,
  Plugs,
  Plus,
  Sun,
  Vault,
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
import {
  getOptionalDesktopBridge,
  type DesktopApiResult,
  type DesktopVaultSummary,
} from '@/lib/runtime/desktop/client'
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

function getVaultActionErrorMessage(error: string): string {
  switch (error) {
    case 'cancelled':
      return ''
    case 'invalid_vault':
      return 'The selected folder is not a valid Arche vault.'
    case 'vault_already_open':
      return 'That vault is already open in another Arche process.'
    case 'vault_launch_failed':
      return 'Arche could not open the selected vault.'
    default:
      return error
  }
}

async function fetchIntegrationSummaries(slug: string): Promise<{
  connectors?: ConnectorSummary[]
  providers?: ProviderSummary[]
}> {
  const [connectorsResponse, providersResponse] = await Promise.all([
    fetch(`/api/u/${slug}/connectors`, { cache: 'no-store' }),
    fetch(`/api/u/${slug}/providers`, { cache: 'no-store' }),
  ])

  const result: {
    connectors?: ConnectorSummary[]
    providers?: ProviderSummary[]
  } = {}

  if (connectorsResponse.ok) {
    const data = (await connectorsResponse.json().catch(() => null)) as { connectors?: ConnectorSummary[] } | null
    result.connectors = Array.isArray(data?.connectors) ? data.connectors : []
  }

  if (providersResponse.ok) {
    const data = (await providersResponse.json().catch(() => null)) as { providers?: ProviderSummary[] } | null
    result.providers = Array.isArray(data?.providers) ? data.providers : []
  }

  return result
}

type WorkspaceTopNavProps = {
  slug: string
  currentVault?: DesktopVaultSummary | null
  mode: WorkspaceMode
  status: 'active' | 'provisioning' | 'offline'
  sessionsUnreadCount?: number
  flowsUnreadCount?: number
  knowledgePendingCount?: number
  macDesktopWindowInset?: boolean
  hideFlowsMode?: boolean
  onModeChange: (mode: WorkspaceMode) => void
  onNavigateConnectors?: () => void
  onNavigateProviders?: () => void
  onNavigateSettings: () => void
  onSyncComplete?: (status: SyncKbResult['status']) => void
}

export function WorkspaceTopNav({
  slug,
  currentVault = null,
  mode,
  status,
  sessionsUnreadCount = 0,
  flowsUnreadCount = 0,
  knowledgePendingCount = 0,
  macDesktopWindowInset = false,
  hideFlowsMode = false,
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [recentVaults, setRecentVaults] = useState<DesktopVaultSummary[]>([])
  const [vaultActionError, setVaultActionError] = useState<string | null>(null)
  const themeOptions = themes ?? []
  const currentVaultPath = currentVault?.path ?? null
  const desktopBridge = currentVaultPath ? getOptionalDesktopBridge() : null

  useEffect(() => {
    let cancelled = false

    async function loadIntegrations() {
      try {
        const result = await fetchIntegrationSummaries(slug)
        if (cancelled) return

        if (result.connectors) {
          setConnectors(result.connectors)
        }
        if (result.providers) {
          setProviders(result.providers)
        }
      } catch {
        // Keep the menu usable when integration status polling fails.
      } finally {
        if (!cancelled) {
          setIsLoadingConnectors(false)
          setIsLoadingProviders(false)
        }
      }
    }

    void loadIntegrations()
    const interval = setInterval(() => {
      void loadIntegrations()
    }, 30000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false
    setRecentVaults([])
    setVaultActionError(null)

    if (!currentVaultPath || !desktopBridge) {
      return () => {
        cancelled = true
      }
    }

    void desktopBridge
      .listRecentVaults()
      .then((vaults) => {
        if (!cancelled) {
          setRecentVaults(vaults.filter((vault) => vault.path !== currentVaultPath))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentVaults([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentVaultPath, desktopBridge])

  function handleVaultActionResult(result: DesktopApiResult) {
    const nextError = result.ok ? null : getVaultActionErrorMessage(result.error) || null
    setVaultActionError(nextError)

    if (result.ok || !nextError) {
      setAccountMenuOpen(false)
    }
  }

  async function handleOpenVault(vaultPath: string) {
    if (!desktopBridge) {
      setVaultActionError('Desktop bridge is unavailable.')
      return
    }

    const result = await desktopBridge.openVault(vaultPath)
    handleVaultActionResult(result)
  }

  async function handleOpenExistingVault() {
    if (!desktopBridge) {
      setVaultActionError('Desktop bridge is unavailable.')
      return
    }

    const result = await desktopBridge.openExistingVault()
    handleVaultActionResult(result)
  }

  async function handleCreateNewVault() {
    if (!desktopBridge) {
      setVaultActionError('Desktop bridge is unavailable.')
      return
    }

    const result = await desktopBridge.openVaultLauncher()
    handleVaultActionResult(result)
  }

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
  const accountMenuLabel = currentVault ? currentVault.name : slug

  return (
    <header
      className={cn(
        'relative z-30 grid shrink-0 items-center gap-3 border-b border-border/30 bg-background px-4',
        macDesktopWindowInset
          ? 'desktop-titlebar-drag h-[56px] grid-cols-[1fr_auto_1fr] pl-[88px]'
          : 'h-14 grid-cols-[auto_1fr] sm:grid-cols-[1fr_auto_1fr]'
      )}
    >
      {macDesktopWindowInset ? (
        <div className="flex min-w-0 items-center" />
      ) : (
        <div className="hidden min-w-0 items-center sm:flex">
          <span className="type-display truncate text-base font-semibold tracking-tight">Arche</span>
        </div>
      )}

      <WorkspaceModeToggle
        mode={mode}
        onModeChange={onModeChange}
        sessionsUnreadCount={sessionsUnreadCount}
        flowsUnreadCount={flowsUnreadCount}
        knowledgePendingCount={knowledgePendingCount}
        hideFlows={hideFlowsMode}
        className={cn(macDesktopWindowInset && 'desktop-titlebar-no-drag')}
      />

      <div className="flex min-w-0 justify-end">
        <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex min-w-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5',
                macDesktopWindowInset && 'desktop-titlebar-no-drag'
              )}
              aria-label="Workspace account menu"
            >
              <span className="max-w-[6rem] truncate font-medium sm:max-w-none">{accountMenuLabel}</span>
              <CaretDown size={13} weight="bold" className="shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-1.5">
            {currentVault ? (
              <>
                <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Vault
                </DropdownMenuLabel>
                <div className="px-2 pb-2">
                  <div className="text-xs font-medium text-foreground">Current vault</div>
                  <div className="truncate text-xs text-muted-foreground">{currentVault.path}</div>
                </div>

                {recentVaults.length > 0 ? (
                  <>
                    <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Recent vaults
                    </DropdownMenuLabel>
                    {recentVaults.map((vault) => (
                      <DropdownMenuItem
                        key={vault.path}
                        onSelect={(event) => {
                          event.preventDefault()
                          void handleOpenVault(vault.path)
                        }}
                        className="gap-2 rounded-lg px-2.5 py-2"
                      >
                        <Vault size={15} weight="bold" className="shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">{vault.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{vault.path}</div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}

                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    void handleCreateNewVault()
                  }}
                  className="gap-2 rounded-lg px-2.5 py-2"
                >
                  <Plus size={15} weight="bold" className="text-muted-foreground" />
                  <span>Create New Vault...</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    void handleOpenExistingVault()
                  }}
                  className="gap-2 rounded-lg px-2.5 py-2"
                >
                  <FolderOpen size={15} weight="bold" className="text-muted-foreground" />
                  <span>Open Vault...</span>
                </DropdownMenuItem>
                {vaultActionError ? (
                  <div className="px-2 py-1 text-xs text-destructive">{vaultActionError}</div>
                ) : null}

                <DropdownMenuSeparator className="my-1.5" />
              </>
            ) : null}

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
