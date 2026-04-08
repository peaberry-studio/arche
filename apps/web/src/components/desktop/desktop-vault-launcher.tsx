'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getDesktopBridge,
  getDesktopPlatform,
  type DesktopApiResult,
  type DesktopVaultSummary,
} from '@/lib/runtime/desktop/client'

const DEFAULT_VAULT_NAME = 'Arche'

function getPathSeparator(): string {
  return getDesktopPlatform() === 'win32' ? '\\' : '/'
}

function joinPreviewPath(parentPath: string, vaultName: string): string {
  const normalizedParentPath = parentPath.trim().replace(/[\\/]+$/, '')
  const normalizedVaultName = vaultName.trim()
  if (!normalizedParentPath) {
    return normalizedVaultName
  }
  if (!normalizedVaultName) {
    return normalizedParentPath
  }

  return `${normalizedParentPath}${getPathSeparator()}${normalizedVaultName}`
}

function getDesktopActionError(error: string): string {
  switch (error) {
    case 'cancelled':
      return ''
    case 'invalid_vault':
      return 'The selected folder is not a valid Arche vault.'
    case 'parent_directory_not_found':
      return 'Choose a valid parent directory for the new vault.'
    case 'vault_already_open':
      return 'That vault is already open in another Arche process.'
    case 'vault_directory_exists':
      return 'The target vault folder already exists and is not empty.'
    case 'vault_create_failed':
      return 'Arche could not create the vault.'
    case 'vault_launch_failed':
      return 'Arche could not launch the selected vault.'
    default:
      return error
  }
}

async function handleDesktopAction(action: () => Promise<DesktopApiResult>): Promise<string | null> {
  const result = await action()
  if (result.ok) {
    return null
  }

  const message = getDesktopActionError(result.error)
  return message || null
}

export function DesktopVaultLauncher() {
  const [vaultName, setVaultName] = useState(DEFAULT_VAULT_NAME)
  const [parentPath, setParentPath] = useState('')
  const [recentVaults, setRecentVaults] = useState<DesktopVaultSummary[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewPath = useMemo(() => joinPreviewPath(parentPath, vaultName), [parentPath, vaultName])

  useEffect(() => {
    let cancelled = false

    void getDesktopBridge()
      .listRecentVaults()
      .then((vaults) => {
        if (!cancelled) {
          setRecentVaults(vaults)
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
  }, [])

  async function handleChooseLocation() {
    setError(null)
    const selectedPath = await getDesktopBridge().pickVaultParentDirectory()
    if (selectedPath) {
      setParentPath(selectedPath)
    }
  }

  async function handleCreateVault() {
    setIsBusy(true)
    setError(null)

    try {
      const nextError = await handleDesktopAction(() =>
        getDesktopBridge().createVault({
          parentPath,
          name: vaultName,
        }),
      )
      setError(nextError)
    } finally {
      setIsBusy(false)
    }
  }

  async function handleOpenExistingVault() {
    setIsBusy(true)
    setError(null)

    try {
      const nextError = await handleDesktopAction(() => getDesktopBridge().openExistingVault())
      setError(nextError)
    } finally {
      setIsBusy(false)
    }
  }

  async function handleOpenRecentVault(vaultPath: string) {
    setIsBusy(true)
    setError(null)

    try {
      const nextError = await handleDesktopAction(() => getDesktopBridge().openVault(vaultPath))
      setError(nextError)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,420px)]">
        <section className="rounded-3xl border border-border/60 bg-card/60 p-8 shadow-sm backdrop-blur">
          <div className="max-w-2xl space-y-6">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.18em] text-primary/80">Desktop Vaults</p>
              <h1 className="type-display text-4xl leading-tight text-foreground sm:text-5xl">
                Open a vault and land straight in the workspace.
              </h1>
              <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                Each vault is a visible folder with its own database, knowledge repos,
                runtime state, and secrets.
              </p>
            </div>

            <div className="space-y-5 rounded-2xl border border-border/60 bg-background/70 p-5">
              <div className="space-y-2">
                <Label htmlFor="desktop-vault-name">Vault name</Label>
                <Input
                  id="desktop-vault-name"
                  value={vaultName}
                  onChange={(event) => setVaultName(event.target.value)}
                  placeholder={DEFAULT_VAULT_NAME}
                  disabled={isBusy}
                />
              </div>

              <div className="space-y-2">
                <Label>Location</Label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={parentPath}
                    readOnly
                    placeholder="Choose a parent folder"
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" onClick={handleChooseLocation} disabled={isBusy}>
                    Choose location
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Final folder
                </p>
                <p className="mt-1 break-all font-mono text-sm text-foreground">
                  {previewPath || DEFAULT_VAULT_NAME}
                </p>
              </div>

              {error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="button" onClick={handleCreateVault} disabled={isBusy || !parentPath.trim()}>
                  Create Vault
                </Button>
                <Button type="button" variant="outline" onClick={handleOpenExistingVault} disabled={isBusy}>
                  Open Existing Vault
                </Button>
              </div>
            </div>
          </div>
        </section>

        <aside className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur">
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Recent vaults</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reopen a recent vault in its own Electron process.
              </p>
            </div>

            {recentVaults.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
                No recent vaults yet.
              </div>
            ) : (
              <div className="space-y-3">
                {recentVaults.map((vault) => (
                  <button
                    key={vault.path}
                    type="button"
                    onClick={() => handleOpenRecentVault(vault.path)}
                    disabled={isBusy}
                    className="flex w-full flex-col rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-background"
                  >
                    <span className="truncate text-sm font-medium text-foreground">{vault.name}</span>
                    <span className="mt-1 truncate text-xs text-muted-foreground">{vault.path}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  )
}
