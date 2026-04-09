'use client'

import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'
import { getTeamErrorMessage } from '@/components/team/error-messages'
import type { TeamUser, TeamUserRole } from '@/components/team/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

type EditUserDialogProps = {
  open: boolean
  slug: string
  user: TeamUser | null
  canManageUsers: boolean
  onOpenChange: (open: boolean) => void
  onUserUpdated: (user: TeamUser) => void
  onUserDeleted: (userId: string) => void
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

  useEffect(() => {
    if (!open || !user) return

    setRole(user.role)
    setActionError(null)
    setShowDeleteConfirm(false)
  }, [open, user])

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

  const handleDeleteUser = useCallback(async () => {
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
  }, [isDeleting, onOpenChange, onUserDeleted, slug, user])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-custom max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="type-display text-xl">Edit user</DialogTitle>
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

            <ProviderCredentialsPanel
              slug={user.slug}
              title="Provider credentials"
              description="Manage API access for this user."
            />

            {canManageUsers ? (
              <>
                <div className="h-px bg-border" />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-destructive">Delete user</h3>
                  <p className="text-sm text-muted-foreground">
                    This permanently removes the user account. The last admin cannot be deleted.
                  </p>

                  {showDeleteConfirm ? (
                    <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
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
