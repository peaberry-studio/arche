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
    case 'openrouter':
      return 'OpenRouter'
    case 'opencode':
      return 'OpenCode Zen'
  }
}

function providerStatusBadge(status: TeamProviderStatus['status']): {
  label: string
  variant: 'default' | 'secondary' | 'outline'
} {
  switch (status) {
    case 'enabled':
      return { label: 'Enabled', variant: 'default' }
    case 'disabled':
      return { label: 'Disabled', variant: 'secondary' }
    case 'missing':
      return { label: 'Missing', variant: 'outline' }
  }
}

export function EditUserDialog({
  open,
  slug,
  user,
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
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !user) return

    setRole(user.role)
    setActionError(null)
    setProviderError(null)
    setProviderApiKeys({})
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
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl">
            Edit user
          </DialogTitle>
          <DialogDescription>
            {user ? `${user.email} (/${user.slug})` : 'Select a user to manage role and provider access.'}
          </DialogDescription>
        </DialogHeader>

        {!user ? null : (
          <div className="space-y-6">
            {actionError ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {actionError}
              </p>
            ) : null}

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
                  const badge = providerStatusBadge(provider.status)
                  const isBusy = Boolean(providerBusy[provider.providerId])
                  const canDisable = provider.status === 'enabled'
                  const canSave = Boolean(providerApiKeys[provider.providerId]?.trim())

                  return (
                    <div key={provider.providerId} className="rounded-xl border border-border/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">{providerLabel(provider.providerId)}</p>
                          <p className="text-xs text-muted-foreground">
                            {provider.version ? `Version ${provider.version}` : 'No credential set'}
                          </p>
                        </div>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>

                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
                          {isBusy ? 'Saving...' : provider.status === 'enabled' ? 'Rotate key' : 'Set key'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isBusy || !canDisable}
                          onClick={() => handleDisableProvider(provider.providerId)}
                        >
                          Disable
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

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
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
