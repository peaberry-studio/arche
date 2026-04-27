/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsLogoutButton } from '@/components/settings/settings-logout-button'

const pushMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

describe('SettingsLogoutButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('posts to logout and redirects to login', async () => {
    render(<SettingsLogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    })
    expect(pushMock).toHaveBeenCalledWith('/login')
    expect(refreshMock).toHaveBeenCalled()
  })
})
