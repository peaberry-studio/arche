/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

const isDesktopMock = vi.fn()
const getCurrentDesktopVaultMock = vi.fn()
const getDesktopWorkspaceHrefMock = vi.fn()
const getSessionMock = vi.fn()
const getRuntimeCapabilitiesMock = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/team/team-page-client', () => ({
  TeamPageClient: (props: { slug: string; isAdmin: boolean; currentUserId: string | null; canManageUsers: boolean }) => (
    <div data-testid="team-page-client">
      {props.slug} {String(props.isAdmin)} {props.currentUserId ?? 'null'} {String(props.canManageUsers)}
    </div>
  ),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
  getDesktopWorkspaceHref: (...args: string[]) => getDesktopWorkspaceHrefMock(...args),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

describe('TeamPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to home when desktop mode has no vault', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue(null)

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/')
  })

  it('redirects desktop users with a vault to the providers page', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultId: 'v1', vaultName: 'Arche', vaultPath: '/tmp/Arche' })
    getDesktopWorkspaceHrefMock.mockReturnValue('/w/local/providers')

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/w/local/providers')
  })

  it('renders TeamPageClient for admin with manage users capability', async () => {
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
      sessionId: 'session-1',
    })
    getRuntimeCapabilitiesMock.mockReturnValue({ teamManagement: true })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByTestId('team-page-client').textContent).toBe('alice true admin-1 true')
  })

  it('renders TeamPageClient for non-admin without manage users capability', async () => {
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'USER', slug: 'alice' },
      sessionId: 'session-1',
    })
    getRuntimeCapabilitiesMock.mockReturnValue({ teamManagement: false })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByTestId('team-page-client').textContent).toBe('alice false user-1 false')
  })

  it('passes null currentUserId when session is missing', async () => {
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue(null)
    getRuntimeCapabilitiesMock.mockReturnValue({ teamManagement: true })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByTestId('team-page-client').textContent).toBe('alice false null true')
  })
})
