/** @vitest-environment jsdom */

import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EditUserDialog } from '@/components/team/edit-user-dialog'
import type { TeamUser } from '@/components/team/types'

vi.mock('@/components/providers/provider-credentials-panel', () => ({
  ProviderCredentialsPanel: () => <div>Provider credentials</div>,
}))

const user: TeamUser = {
  id: 'user-2',
  email: 'bob@example.com',
  slug: 'bob',
  role: 'USER',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function renderDialog(overrides?: Partial<ComponentProps<typeof EditUserDialog>>) {
  return render(
    <EditUserDialog
      open
      slug="admin"
      user={user}
      canManageUsers
      onOpenChange={vi.fn()}
      onUserUpdated={vi.fn()}
      onUserDeleted={vi.fn()}
      {...overrides}
    />
  )
}

describe('EditUserDialog password reset', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('submits a new password to the reset endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as Response)

    renderDialog()

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'temporary-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/u/admin/team/user-2/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'temporary-password' }),
      })
    })
    expect(await screen.findByText('Password reset. Share the new password securely.')).toBeTruthy()
  })

  it('shows a friendly error when reset fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'invalid_password' }),
    } as Response)

    renderDialog()

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'temporary-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText('Password is required.')).toBeTruthy()
  })

  it('shows server validation messages when present', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({
        error: 'invalid_password',
        message: 'Password must be at least 8 characters.',
      }),
    } as Response)

    renderDialog()

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'short' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeTruthy()
  })

  it('hides password reset controls when user management is unavailable', () => {
    renderDialog({ canManageUsers: false })

    expect(screen.queryByText('Reset password')).toBeNull()
    expect(screen.getByText('Provider credentials')).toBeTruthy()
  })
})
