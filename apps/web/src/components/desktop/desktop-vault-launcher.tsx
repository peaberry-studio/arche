'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ClockCounterClockwise,
  FolderOpen,
  Plus,
  SpinnerGap,
  Vault,
} from '@phosphor-icons/react'

import {
  KickstartWizard,
  type KickstartWizardLoadCatalogResult,
  type KickstartWizardSubmitResult,
} from '@/components/kickstart/kickstart-wizard'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { KickstartAgentSummary, KickstartTemplateSummary } from '@/kickstart/types'
import { DEFAULT_NEW_VAULT_NAME } from '@/lib/runtime/desktop/vault-layout-constants'
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
  const [mode, setMode] = useState<'create' | null>(null)
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
          <div className="space-y-5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <SpinnerGap size={24} className="animate-spin text-primary" />
            </div>
            <h1 className="type-display text-3xl leading-tight text-foreground">
              {status.title}
            </h1>
            <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
              {status.description}
            </p>
            <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-muted/40">
              <div className="h-full animate-[progress-sweep_1.8s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
      <div className={mode === 'create'
        ? 'w-full'
        : 'grid w-full gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,420px)]'
      }>
        <section className="rounded-3xl border border-border/60 bg-card/60 p-8 shadow-sm backdrop-blur">
          <div className="max-w-2xl space-y-6">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.18em] text-primary/80">Welcome to Arche</p>
              <h1 className="type-display text-3xl leading-tight text-foreground sm:text-4xl">
                Set up your workspace
              </h1>
              <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                A vault is a self-contained workspace where Arche keeps your repos, agents,
                and knowledge base organized.
              </p>
            </div>

            {!mode && (
              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode('create')}
                  className="group rounded-2xl border border-border/60 bg-background/60 p-5 text-left transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-subtle"
                >
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                    <Plus size={20} weight="bold" />
                  </div>
                  <p className="font-medium text-foreground">Create new vault</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Pick a template, configure agents, and get started.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={handleOpenExistingVault}
                  className="group rounded-2xl border border-border/60 bg-background/60 p-5 text-left transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-subtle"
                >
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                    <FolderOpen size={20} weight="bold" />
                  </div>
                  <p className="font-medium text-foreground">Open existing vault</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Browse your filesystem for an existing Arche vault.
                  </p>
                </button>
              </div>
            )}

            {mode === 'create' && (
              <KickstartWizard
                embedded
                loadCatalog={loadDesktopKickstartCatalog}
                onBack={() => setMode(null)}
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
                        <button
                          type="button"
                          onClick={handleChooseLocation}
                          className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                        >
                          Choose location
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Vault path
                      </p>
                      <p className="mt-1 break-all font-mono text-sm text-foreground/80">
                        {previewPath || (
                          <span className="italic text-muted-foreground">Choose a location above</span>
                        )}
                      </p>
                    </div>
                  </>
                )}
                stepOneReadyOverride={stepOneReady}
                submitLabel="Create vault"
                submittingLabel="Creating vault"
              />
            )}

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        </section>

        {!mode && <aside className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur">
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Recent vaults</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reopen a recent vault in its own window.
              </p>
            </div>

            {recentVaults.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center">
                <ClockCounterClockwise size={24} className="mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No recent vaults yet.</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Vaults you open will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentVaults.map((vault) => (
                  <button
                    key={vault.path}
                    type="button"
                    onClick={() => handleOpenRecentVault(vault.path)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-left transition-all hover:border-primary/30 hover:bg-background hover:shadow-subtle"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground">
                      <Vault size={18} />
                    </div>
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{vault.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{vault.path}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>}
      </div>
    </main>
  )
}
