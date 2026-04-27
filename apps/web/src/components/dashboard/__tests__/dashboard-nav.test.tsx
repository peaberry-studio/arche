/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardNav } from '@/components/dashboard/dashboard-nav'

const pushMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/u/admin',
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

describe('DashboardNav logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('posts to logout and redirects to login', async () => {
    render(<DashboardNav slug="admin" />)

    fireEvent.click(screen.getByLabelText('Log out'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    })
    expect(pushMock).toHaveBeenCalledWith('/login')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('does not show logout in desktop mode', () => {
    render(<DashboardNav slug="local" desktopMode />)

    expect(screen.queryByLabelText('Log out')).toBeNull()
  })
})
