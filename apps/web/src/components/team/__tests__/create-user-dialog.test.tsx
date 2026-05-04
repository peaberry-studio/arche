/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateUserDialog } from '@/components/team/create-user-dialog'
import type { TeamUser } from '@/components/team/types'

const createdUser: TeamUser = {
  id: 'user-3',
  email: 'new.user@example.com',
  slug: 'new-user',
  role: 'ADMIN',
  createdAt: '2026-01-03T00:00:00.000Z',
}

function renderDialog(overrides?: Partial<Parameters<typeof CreateUserDialog>[0]>) {
  return render(
    <CreateUserDialog
      open
      slug="alice"
      onOpenChange={vi.fn()}
      onUserCreated={vi.fn()}
      {...overrides}
    />
  )
}

describe('CreateUserDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('creates a user and closes the dialog', async () => {
    const onOpenChange = vi.fn()
    const onUserCreated = vi.fn()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: createdUser }),
    } as Response)

    renderDialog({ onOpenChange, onUserCreated })

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new.user@example.com' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'new-user' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ADMIN' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/u/alice/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'new.user@example.com',
          slug: 'new-user',
          password: 'temporary-password',
          role: 'ADMIN',
        }),
      })
    })
    expect(onUserCreated).toHaveBeenCalledWith(createdUser)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows server messages and network errors', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Email belongs to another user.' }),
      } as Response)
      .mockRejectedValueOnce(new Error('network'))

    const { rerender } = renderDialog()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new.user@example.com' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'new-user' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))
    expect(await screen.findByText('Email belongs to another user.')).toBeTruthy()

    rerender(
      <CreateUserDialog
        open={false}
        slug="alice"
        onOpenChange={vi.fn()}
        onUserCreated={vi.fn()}
      />
    )
    rerender(
      <CreateUserDialog
        open
        slug="alice"
        onOpenChange={vi.fn()}
        onUserCreated={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'other@example.com' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'other' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))

    expect(await screen.findByText('Network error. Please try again.')).toBeTruthy()
  })
})
