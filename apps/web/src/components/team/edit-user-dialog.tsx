'use client'

import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { getTeamErrorMessage } from '@/components/team/error-messages'
import type { TeamProviderStatus, TeamUser, TeamUserRole } from '@/components/team/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProviderId } from '@/lib/providers/types'

type EditUserDialogProps = {
  open: boolean
  slug: string
  user: TeamUser | null
  canManageUsers: boolean
  onOpenChange: (open: boolean) => void
  onUserUpdated: (user: TeamUser) => void
  onUserDeleted: (userId: string) => void
}

function providerLabel(providerId: ProviderId): string {
  switch (providerId) {
    case 'openai':
      return 'OpenAI'
    case 'anthropic':
      return 'Anthropic'
    case 'fireworks':
      return 'Fireworks AI'
    case 'openrouter':
      return 'OpenRouter'
    case 'opencode':
      return 'OpenCode Zen'
  }
}


export function EditUserDialog({
  open,
  slug,
  user,
  canManageUsers,
  onOpenChange,
  onUserUpdated,
  onUserDeleted,
}: EditUserDialogProps) {
  const [role, setRole] = useState<TeamUserRole>('USER')
  const [isSavingRole, setIsSavingRole] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [providers, setProviders] = useState<TeamProviderStatus[]>([])
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({})
  const [providerBusy, setProviderBusy] = useState<Record<string, boolean>>({})
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({})
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !user) return

    setRole(user.role)
    setActionError(null)
    setProviderError(null)
    setProviderApiKeys({})
    setExpandedProviders({})
    setShowDeleteConfirm(false)
  }, [open, user])

  const loadProviders = useCallback(async () => {
    if (!user) return

    setIsLoadingProviders(true)
    setProviderError(null)

    try {
      const response = await fetch(`/api/u/${user.slug}/providers`, {
        cache: 'no-store',
      })
      const data = (await response.json().catch(() => null)) as
        | { providers?: TeamProviderStatus[]; error?: string }
        | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'load_failed'))
        return
      }

      setProviders(data?.providers ?? [])
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setIsLoadingProviders(false)
    }
  }, [user])

  useEffect(() => {
    if (!open || !user) return
    void loadProviders()
  }, [loadProviders, open, user])

  async function handleSaveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || isSavingRole) return

    setActionError(null)
    setIsSavingRole(true)

    try {
      const response = await fetch(`/api/u/${slug}/team/${user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      const data = (await response.json().catch(() => null)) as
        | { user?: TeamUser; error?: string }
        | null

      if (!response.ok || !data?.user) {
        setActionError(getTeamErrorMessage(data?.error ?? 'update_failed'))
        return
      }

      onUserUpdated(data.user)
    } catch {
      setActionError(getTeamErrorMessage('network_error'))
    } finally {
      setIsSavingRole(false)
    }
  }

  async function handleDeleteUser() {
    if (!user || isDeleting) return

    setActionError(null)
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/u/${slug}/team/${user.id}`, {
        method: 'DELETE',
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setActionError(getTeamErrorMessage(data?.error ?? 'delete_failed'))
        return
      }

      onUserDeleted(user.id)
      onOpenChange(false)
    } catch {
      setActionError(getTeamErrorMessage('network_error'))
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleSaveProvider(providerId: ProviderId) {
    if (!user) return

    const apiKey = providerApiKeys[providerId]?.trim() ?? ''
    if (!apiKey) return

    setProviderBusy((current) => ({ ...current, [providerId]: true }))
    setProviderError(null)

    try {
      const response = await fetch(`/api/u/${user.slug}/providers/${providerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'provider_update_failed'))
        return
      }

      setProviderApiKeys((current) => ({ ...current, [providerId]: '' }))
      setExpandedProviders((current) => ({ ...current, [providerId]: false }))
      await loadProviders()
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setProviderBusy((current) => ({ ...current, [providerId]: false }))
    }
  }

  async function handleDisableProvider(providerId: ProviderId) {
    if (!user) return

    setProviderBusy((current) => ({ ...current, [providerId]: true }))
    setProviderError(null)

    try {
      const response = await fetch(`/api/u/${user.slug}/providers/${providerId}`, {
        method: 'DELETE',
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'provider_disable_failed'))
        return
      }

      setExpandedProviders((current) => ({ ...current, [providerId]: false }))
      await loadProviders()
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setProviderBusy((current) => ({ ...current, [providerId]: false }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-custom max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="type-display text-xl">
            Edit user
          </DialogTitle>
          <DialogDescription>
            {user
              ? `${user.email} (/${user.slug})`
              : canManageUsers
                ? 'Select a user to manage role and provider access.'
                : 'Select a user to manage provider access.'}
          </DialogDescription>
        </DialogHeader>

        {!user ? null : (
          <div className="space-y-6">
            {actionError ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {actionError}
              </p>
            ) : null}

            {canManageUsers ? (
              <>
                <form className="space-y-4" onSubmit={handleSaveRole}>
                  <h3 className="text-sm font-semibold text-foreground">Role</h3>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="w-full space-y-1.5 sm:max-w-xs">
                      <Label htmlFor="edit-user-role" className="sr-only">Role</Label>
                      <select
                        id="edit-user-role"
                        className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
                        value={role}
                        onChange={(event) => setRole(event.target.value === 'ADMIN' ? 'ADMIN' : 'USER')}
                      >
                        <option value="USER">User</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </div>

                    <Button type="submit" size="sm" disabled={isSavingRole || role === user.role}>
                      {isSavingRole ? 'Saving...' : 'Save role'}
                    </Button>
                  </div>
                </form>

                <div className="h-px bg-border" />
              </>
            ) : null}

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Provider credentials</h3>
                {isLoadingProviders ? (
                  <span className="text-xs text-muted-foreground">Loading...</span>
                ) : null}
              </div>

              {providerError ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {providerError}
                </p>
              ) : null}

              <div className="space-y-3">
                {providers.map((provider) => {
                  const isBusy = Boolean(providerBusy[provider.providerId])
                  const isExpanded = Boolean(expandedProviders[provider.providerId])
                  const canSave = Boolean(providerApiKeys[provider.providerId]?.trim())
                  const isInactive = provider.status === 'missing' || provider.status === 'disabled'

                  if (isInactive && !isExpanded) {
                    // Variante A: inactivo colapsado — solo nombre + botón Enable
                    return (
                      <div key={provider.providerId} className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{providerLabel(provider.providerId)}</p>
                          <p className="text-xs text-muted-foreground">No credential set</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setExpandedProviders((current) => ({ ...current, [provider.providerId]: true }))
                          }
                        >
                          Enable
                        </Button>
                      </div>
                    )
                  }

                  if (isInactive && isExpanded) {
                    // Variante B: inactivo expandido — input + Set key + Cancel
                    return (
                      <div key={provider.providerId} className="rounded-xl border border-border/60 px-4 py-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">{providerLabel(provider.providerId)}</p>
                            <p className="text-xs text-muted-foreground">No credential set</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isBusy}
                            onClick={() => {
                              setExpandedProviders((current) => ({ ...current, [provider.providerId]: false }))
                              setProviderApiKeys((current) => ({ ...current, [provider.providerId]: '' }))
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            type="password"
                            value={providerApiKeys[provider.providerId] ?? ''}
                            onChange={(event) =>
                              setProviderApiKeys((current) => ({
                                ...current,
                                [provider.providerId]: event.target.value,
                              }))
                            }
                            placeholder="Paste API key"
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={isBusy || !canSave}
                            onClick={() => handleSaveProvider(provider.providerId)}
                          >
                            {isBusy ? 'Saving...' : 'Set key'}
                          </Button>
                        </div>
                      </div>
                    )
                  }

                  if (!isExpanded) {
                    // Variante C: enabled colapsado — nombre + versión + badge + Rotate + Disable
                    return (
                      <div key={provider.providerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{providerLabel(provider.providerId)}</p>
                          {provider.version ? (
                            <span className="text-xs text-muted-foreground">v{provider.version}</span>
                          ) : null}
                          <Badge variant="default">Enabled</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() =>
                              setExpandedProviders((current) => ({ ...current, [provider.providerId]: true }))
                            }
                          >
                            Rotate key
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => handleDisableProvider(provider.providerId)}
                          >
                            {isBusy ? 'Disabling...' : 'Disable'}
                          </Button>
                        </div>
                      </div>
                    )
                  }

                  // Variante D: enabled expandido — nombre + versión + badge + input + Rotate key + Cancel
                  return (
                    <div key={provider.providerId} className="rounded-xl border border-border/60 px-4 py-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{providerLabel(provider.providerId)}</p>
                          {provider.version ? (
                            <span className="text-xs text-muted-foreground">v{provider.version}</span>
                          ) : null}
                          <Badge variant="default">Enabled</Badge>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() => {
                            setExpandedProviders((current) => ({ ...current, [provider.providerId]: false }))
                            setProviderApiKeys((current) => ({ ...current, [provider.providerId]: '' }))
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          type="password"
                          value={providerApiKeys[provider.providerId] ?? ''}
                          onChange={(event) =>
                            setProviderApiKeys((current) => ({
                              ...current,
                              [provider.providerId]: event.target.value,
                            }))
                          }
                          placeholder="Paste API key"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy || !canSave}
                          onClick={() => handleSaveProvider(provider.providerId)}
                        >
                          {isBusy ? 'Saving...' : 'Rotate key'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {canManageUsers ? (
              <>
                <div className="h-px bg-border" />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-destructive">Delete user</h3>
                  <p className="text-sm text-muted-foreground">
                    This permanently removes the user account. The last admin cannot be deleted.
                  </p>

                  {showDeleteConfirm ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                      <p className="text-sm text-foreground">
                        Are you sure you want to delete <span className="font-semibold">{user.email}</span>? This action cannot be undone.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={isDeleting}
                          onClick={handleDeleteUser}
                        >
                          {isDeleting ? 'Deleting...' : 'Confirm delete'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isDeleting}
                          onClick={() => setShowDeleteConfirm(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      Delete user
                    </Button>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
