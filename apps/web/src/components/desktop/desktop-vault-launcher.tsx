'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  KickstartWizard,
  type KickstartWizardLoadCatalogResult,
  type KickstartWizardSubmitResult,
} from '@/components/kickstart/kickstart-wizard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_NEW_VAULT_NAME } from '@desktop/vault-layout-constants'
import type { KickstartAgentSummary, KickstartTemplateSummary } from '@/kickstart/types'
import {
  getDesktopBridge,
  getDesktopPlatform,
  type DesktopApiResult,
  type DesktopVaultSummary,
} from '@/lib/runtime/desktop/client'

const LAUNCHER_CLOSE_DELAY_MS = 900

type LauncherStatus = {
  title: string
  description: string
}

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
    case 'vault_setup_failed':
      return 'Arche could not finish the selected onboarding template for the new vault.'
    case 'vault_launch_failed':
      return 'Arche could not launch the selected vault.'
    case 'launcher_not_active':
      return 'The launcher is no longer active in this window.'
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

async function closeLauncherAfterSuccess(): Promise<void> {
  const result = await getDesktopBridge().quitLauncherProcess()
  if (!result.ok) {
    throw new Error(getDesktopActionError(result.error) || result.error)
  }
}

export function DesktopVaultLauncher() {
  const [vaultName, setVaultName] = useState(DEFAULT_NEW_VAULT_NAME)
  const [parentPath, setParentPath] = useState('')
  const [recentVaults, setRecentVaults] = useState<DesktopVaultSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<LauncherStatus | null>(null)

  const previewPath = useMemo(() => joinPreviewPath(parentPath, vaultName), [parentPath, vaultName])
  const stepOneReady = parentPath.trim().length > 0 && vaultName.trim().length > 0

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

  async function finishSuccessfulLaunch(nextStatus: LauncherStatus) {
    setStatus(nextStatus)
    await new Promise((resolve) => window.setTimeout(resolve, LAUNCHER_CLOSE_DELAY_MS))
    await closeLauncherAfterSuccess()
  }

  const loadDesktopKickstartCatalog = useCallback(async (): Promise<KickstartWizardLoadCatalogResult> => {
    try {
      const response = await fetch('/api/internal/desktop/kickstart/catalog', {
        cache: 'no-store',
      })
      const data = (await response.json().catch(() => null)) as {
        agents?: KickstartAgentSummary[]
        error?: string
        models?: Array<{ id: string; label: string }>
        templates?: KickstartTemplateSummary[]
      } | null

      if (
        !response.ok ||
        !data ||
        !Array.isArray(data.templates) ||
        !Array.isArray(data.agents) ||
        !Array.isArray(data.models)
      ) {
        return {
          ok: false,
          error: data?.error ?? 'Failed to load onboarding catalog for the new vault.',
        }
      }

      return {
        ok: true,
        catalog: {
          agents: data.agents,
          templates: data.templates,
        },
        models: data.models,
      }
    } catch {
      return {
        ok: false,
        error: 'Failed to load onboarding catalog for the new vault.',
      }
    }
  }, [])

  async function handleCreateVault(kickstartPayload: unknown): Promise<KickstartWizardSubmitResult> {
    setError(null)
    setStatus({
      title: 'Creating vault...',
      description: 'Arche is preparing the folder, hidden data, repositories, and workspace from your setup.',
    })

    try {
      const nextError = await handleDesktopAction(() =>
        getDesktopBridge().createVault({
          kickstartPayload,
          parentPath,
          name: vaultName,
        }),
      )

      if (nextError) {
        setStatus(null)
        return { ok: false, error: nextError }
      }

      await finishSuccessfulLaunch({
        title: 'Vault created',
        description: 'Opening the new vault directly in the configured workspace...',
      })

      return { ok: true }
    } catch (launchError) {
      setStatus(null)
      return {
        ok: false,
        error: launchError instanceof Error ? launchError.message : 'Arche could not close the launcher.',
      }
    }
  }

  async function handleOpenExistingVault() {
    setError(null)
    setStatus({
      title: 'Opening vault...',
      description: 'Arche will validate the selected folder and open it in a dedicated window.',
    })

    try {
      const nextError = await handleDesktopAction(() => getDesktopBridge().openExistingVault())

      if (nextError) {
        setStatus(null)
        setError(nextError)
        return
      }

      await finishSuccessfulLaunch({
        title: 'Opening vault...',
        description: 'The selected vault is being opened in a new Arche window...',
      })
    } catch (launchError) {
      setStatus(null)
      setError(launchError instanceof Error ? launchError.message : 'Arche could not close the launcher.')
    }
  }

  async function handleOpenRecentVault(vaultPath: string) {
    setError(null)
    const vault = recentVaults.find((entry) => entry.path === vaultPath)
    setStatus({
      title: 'Opening vault...',
      description: vault
        ? `Opening ${vault.name} in a dedicated Arche window...`
        : 'Opening the selected vault in a dedicated Arche window...',
    })

    try {
      const nextError = await handleDesktopAction(() => getDesktopBridge().openVault(vaultPath))

      if (nextError) {
        setStatus(null)
        setError(nextError)
        return
      }

      await finishSuccessfulLaunch({
        title: 'Opening vault...',
        description: vault
          ? `${vault.name} is being opened in a new Arche window...`
          : 'The selected vault is being opened in a new Arche window...',
      })
    } catch (launchError) {
      setStatus(null)
      setError(launchError instanceof Error ? launchError.message : 'Arche could not close the launcher.')
    }
  }

  if (status) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6 py-10">
        <section className="w-full max-w-2xl rounded-3xl border border-border/60 bg-card/70 p-10 text-center shadow-sm backdrop-blur">
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-primary/80">Desktop Vaults</p>
            <h1 className="type-display text-4xl leading-tight text-foreground sm:text-5xl">
              {status.title}
            </h1>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground sm:text-base">
              {status.description}
            </p>
            <div className="mx-auto mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-muted/60">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,420px)]">
        <section className="rounded-3xl border border-border/60 bg-card/60 p-8 shadow-sm backdrop-blur">
          <div className="max-w-2xl space-y-6">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.18em] text-primary/80">Desktop Vaults</p>
              <h1 className="type-display text-4xl leading-tight text-foreground sm:text-5xl">
                Create a vault and finish setup before it opens.
              </h1>
              <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                Each vault keeps the workspace visible while Arche stores repos, runtime state,
                and secrets in hidden folders.
              </p>
            </div>

            <KickstartWizard
              loadCatalog={loadDesktopKickstartCatalog}
              onSubmit={handleCreateVault}
              renderStepOneExtras={(
                <>
                  <div className="space-y-2">
                    <Label htmlFor="desktop-vault-name">Vault name</Label>
                    <Input
                      id="desktop-vault-name"
                      value={vaultName}
                      onChange={(event) => setVaultName(event.target.value)}
                       placeholder={DEFAULT_NEW_VAULT_NAME}
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
                      <Button type="button" variant="outline" onClick={handleChooseLocation}>
                        Choose location
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Final folder
                    </p>
                    <p className="mt-1 break-all font-mono text-sm text-foreground">
                       {previewPath || DEFAULT_NEW_VAULT_NAME}
                    </p>
                  </div>
                </>
              )}
              stepOneReadyOverride={stepOneReady}
              submitLabel="Create vault"
              submittingLabel="Creating vault"
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="outline" onClick={handleOpenExistingVault}>
                Open Existing Vault
              </Button>
            </div>

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
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
