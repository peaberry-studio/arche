/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TeamPageClient } from '@/components/team/team-page-client'
import type { TeamUser } from '@/components/team/types'

type CreateDialogProps = {
  onOpenChange: (open: boolean) => void
  onUserCreated: (user: TeamUser) => void
  open: boolean
  slug: string
}

type EditDialogProps = {
  canManageUsers: boolean
  onOpenChange: (open: boolean) => void
  onUserDeleted: (userId: string) => void
  onUserUpdated: (user: TeamUser) => void
  open: boolean
  slug: string
  user: TeamUser | null
}

const dialogProps = vi.hoisted(() => ({
  create: undefined as CreateDialogProps | undefined,
  edit: undefined as EditDialogProps | undefined,
}))

vi.mock('@/components/team/create-user-dialog', () => ({
  CreateUserDialog: (props: CreateDialogProps) => {
    dialogProps.create = props
    return <div data-open={String(props.open)} data-testid="create-user-dialog" />
  },
}))

vi.mock('@/components/team/edit-user-dialog', () => ({
  EditUserDialog: (props: EditDialogProps) => {
    dialogProps.edit = props
    return <div data-open={String(props.open)} data-testid="edit-user-dialog" />
  },
}))

const users: TeamUser[] = [
  {
    id: 'user-1',
    email: 'user@example.com',
    slug: 'user',
    role: 'USER',
    createdAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'admin-1',
    email: 'admin@example.com',
    slug: 'admin',
    role: 'ADMIN',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response
}

describe('TeamPageClient', () => {
  beforeEach(() => {
    dialogProps.create = undefined
    dialogProps.edit = undefined
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads, sorts, creates, updates, and removes users through dialog callbacks', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ users }))

    render(<TeamPageClient slug="alice" isAdmin currentUserId="user-1" canManageUsers />)

    const adminEmail = await screen.findByText('admin@example.com')
    const userEmail = screen.getByText('user@example.com')
    expect(adminEmail.compareDocumentPosition(userEmail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/u/alice/team', { cache: 'no-store' })

    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))
    expect(dialogProps.create?.open).toBe(true)

    const newUser: TeamUser = {
      id: 'user-3',
      email: 'new@example.com',
      slug: 'new',
      role: 'USER',
      createdAt: '2026-01-04T00:00:00.000Z',
    }
    act(() => dialogProps.create?.onUserCreated(newUser))
    expect(screen.getByText('new@example.com')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Edit admin@example.com'))
    expect(dialogProps.edit?.open).toBe(true)
    expect(dialogProps.edit?.user?.id).toBe('admin-1')

    act(() => dialogProps.edit?.onUserUpdated({ ...users[1], email: 'admin-renamed@example.com' }))
    expect(screen.getByText('admin-renamed@example.com')).toBeTruthy()

    act(() => dialogProps.edit?.onUserDeleted('admin-1'))
    expect(screen.queryByText('admin-renamed@example.com')).toBeNull()
  })

  it('renders load errors, retries, and hides admin controls for regular users', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, false))
      .mockResolvedValueOnce(jsonResponse({ users: [] }))

    render(
      <TeamPageClient
        slug="alice"
        isAdmin={false}
        currentUserId="user-1"
        canManageUsers={false}
      />
    )

    expect(await screen.findByText(/Failed to load team directory/)).toBeTruthy()
    expect(screen.getByText(/You do not have permission for this action/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add user' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('No users found.')).toBeTruthy()
  })
})
