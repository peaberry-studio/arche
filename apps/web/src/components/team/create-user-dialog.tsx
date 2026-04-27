'use client'

import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type CreateUserDialogProps = {
  open: boolean
  slug: string
  onOpenChange: (open: boolean) => void
  onUserCreated: (user: TeamUser) => void
}

export function CreateUserDialog({ open, slug, onOpenChange, onUserCreated }: CreateUserDialogProps) {
  const [email, setEmail] = useState('')
  const [userSlug, setUserSlug] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<TeamUserRole>('USER')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setEmail('')
      setUserSlug('')
      setPassword('')
      setRole('USER')
      setError(null)
      setIsSaving(false)
    }
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    setError(null)
    setIsSaving(true)

    try {
      const response = await fetch(`/api/u/${slug}/team`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          slug: userSlug,
          password,
          role,
        }),
      })

      const data = (await response.json().catch(() => null)) as
        | { user?: TeamUser; error?: string; message?: string }
        | null

      if (!response.ok || !data?.user) {
        setError(data?.message ?? getTeamErrorMessage(data?.error ?? 'create_failed'))
        return
      }

      onUserCreated(data.user)
      onOpenChange(false)
    } catch {
      setError(getTeamErrorMessage('network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-custom max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="type-display text-xl">
            Add user
          </DialogTitle>
          <DialogDescription>
            Create a new account and assign the initial role.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="create-user-email">Email</Label>
            <Input
              id="create-user-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="new.user@company.com"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-user-slug">Slug</Label>
              <Input
                id="create-user-slug"
                value={userSlug}
                onChange={(event) => setUserSlug(event.target.value)}
                placeholder="new-user"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-user-role">Role</Label>
              <select
                id="create-user-role"
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
                value={role}
                onChange={(event) => setRole(event.target.value === 'ADMIN' ? 'ADMIN' : 'USER')}
              >
                <option value="USER">User</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-user-password">Password</Label>
            <Input
              id="create-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Set a temporary password"
              required
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Creating...' : 'Add user'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
