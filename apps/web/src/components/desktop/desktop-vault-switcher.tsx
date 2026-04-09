'use client'

import { useEffect, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getOptionalDesktopBridge,
  type DesktopVaultSummary,
} from '@/lib/runtime/desktop/client'

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

type DesktopVaultSwitcherProps = {
  currentVault: DesktopVaultSummary
}

export function DesktopVaultSwitcher({ currentVault }: DesktopVaultSwitcherProps) {
  const [recentVaults, setRecentVaults] = useState<DesktopVaultSummary[]>([])
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const bridge = getOptionalDesktopBridge()
    if (!bridge) {
      return () => {
        cancelled = true
      }
    }

    void bridge
      .listRecentVaults()
      .then((vaults) => {
        if (!cancelled) {
          setRecentVaults(vaults.filter((vault) => vault.path !== currentVault.path))
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
  }, [currentVault.path])

  async function handleOpenVault(vaultPath: string) {
    const bridge = getOptionalDesktopBridge()
    if (!bridge) {
      return
    }

    const result = await bridge.openVault(vaultPath)
    setActionError(result.ok ? null : getVaultActionErrorMessage(result.error) || null)
  }

  async function handleOpenExistingVault() {
    const bridge = getOptionalDesktopBridge()
    if (!bridge) {
      return
    }

    const result = await bridge.openExistingVault()
    setActionError(result.ok ? null : getVaultActionErrorMessage(result.error) || null)
  }

  async function handleCreateNewVault() {
    const bridge = getOptionalDesktopBridge()
    if (!bridge) {
      return
    }

    const result = await bridge.openVaultLauncher()
    setActionError(result.ok ? null : getVaultActionErrorMessage(result.error) || null)
  }

  return (
    <div className="min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 truncate rounded-lg px-2 py-1 transition-colors hover:bg-foreground/5"
          >
            <span className="truncate text-sm font-medium text-foreground">{currentVault.name}</span>
            <CaretDown size={12} weight="bold" className="shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel>Current vault</DropdownMenuLabel>
          <div className="px-2 pb-2 text-xs text-muted-foreground">{currentVault.path}</div>

          {recentVaults.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Recent vaults</DropdownMenuLabel>
              {recentVaults.map((vault) => (
                <DropdownMenuItem key={vault.path} onClick={() => void handleOpenVault(vault.path)}>
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{vault.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{vault.path}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void handleCreateNewVault()}>Create New Vault...</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleOpenExistingVault()}>Open Existing Vault...</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {actionError ? (
        <p className="mt-1 text-xs text-destructive">{actionError}</p>
      ) : null}
    </div>
  )
}
