'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PencilSimple, SpinnerGap } from '@phosphor-icons/react'

import { CreateUserDialog } from '@/components/team/create-user-dialog'
import { EditUserDialog } from '@/components/team/edit-user-dialog'
import { getTeamErrorMessage } from '@/components/team/error-messages'
import type { TeamUser } from '@/components/team/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type TeamPageClientProps = {
  slug: string
  isAdmin: boolean
  currentUserId: string | null
}

function formatCreatedAt(value: string): string {
  const createdAt = new Date(value)
  if (Number.isNaN(createdAt.getTime())) {
    return 'Unknown date'
  }

  return createdAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function TeamPageClient({ slug, isAdmin, currentUserId }: TeamPageClientProps) {
  const [users, setUsers] = useState<TeamUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<TeamUser | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.role === 'ADMIN' && b.role !== 'ADMIN') return -1
        if (a.role !== 'ADMIN' && b.role === 'ADMIN') return 1
        return b.createdAt.localeCompare(a.createdAt)
      }),
    [users]
  )

  const loadUsers = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/u/${slug}/team`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | { users?: TeamUser[]; error?: string }
        | null

      if (!response.ok) {
        setLoadError(getTeamErrorMessage(data?.error ?? 'load_failed'))
        return
      }

      setUsers(data?.users ?? [])
    } catch {
      setLoadError(getTeamErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const handleUserCreated = useCallback((user: TeamUser) => {
    setUsers((current) => [user, ...current.filter((entry) => entry.id !== user.id)])
  }, [])

  const handleUserUpdated = useCallback((user: TeamUser) => {
    setUsers((current) => current.map((entry) => (entry.id === user.id ? user : entry)))
    setEditingUser(user)
  }, [])

  const handleUserDeleted = useCallback((userId: string) => {
    setUsers((current) => current.filter((entry) => entry.id !== userId))
    setEditingUser((current) => (current?.id === userId ? null : current))
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    setIsEditDialogOpen(open)
    if (!open) {
      setEditingUser(null)
    }
  }, [])

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">
              Team
            </h1>
            <p className="text-muted-foreground">
              Directory of all users in this Arche installation.
            </p>
          </div>
          {isAdmin ? (
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(true)}>Add user</Button>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-border/60 bg-card/40">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpinnerGap size={16} className="animate-spin" />
              Loading team directory...
            </div>
          </div>
        ) : null}

        {!isLoading && loadError ? (
          <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
            Failed to load team directory: {loadError}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={loadUsers}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {!isLoading && !loadError && sortedUsers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
            No users found.
          </div>
        ) : null}

        {!isLoading && !loadError && sortedUsers.length > 0 ? (
          <div className="space-y-3">
            {sortedUsers.map((user) => (
              <Card key={user.id} className="border-border/60 bg-card/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold text-foreground">{user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      /{user.slug} - created {formatCreatedAt(user.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>{user.role}</Badge>
                    {user.id === currentUserId ? <Badge variant="outline">You</Badge> : null}
                    {isAdmin ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingUser(user)
                          setIsEditDialogOpen(true)
                        }}
                        aria-label={`Edit ${user.email}`}
                      >
                        <PencilSimple size={16} weight="bold" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {isAdmin ? (
          <CreateUserDialog
            open={isCreateDialogOpen}
            slug={slug}
            onOpenChange={setIsCreateDialogOpen}
            onUserCreated={handleUserCreated}
          />
        ) : null}

        {isAdmin ? (
          <EditUserDialog
            open={isEditDialogOpen}
            slug={slug}
            user={editingUser}
            onOpenChange={handleEditOpenChange}
            onUserUpdated={handleUserUpdated}
            onUserDeleted={handleUserDeleted}
          />
        ) : null}
      </div>
    </main>
  )
}
