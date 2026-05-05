/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

const isDesktopMock = vi.fn()
const getCurrentDesktopVaultMock = vi.fn()
const getSessionMock = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/desktop/desktop-vault-launcher', () => ({
  DesktopVaultLauncher: () => <div>Desktop Vault Launcher</div>,
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

describe('app home page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the desktop vault launcher when no desktop vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue(null)

    const Home = (await import('../page')).default
    render(await Home())

    expect(screen.getByText('Desktop Vault Launcher')).toBeTruthy()
  })

  it('redirects desktop mode with an active vault to the workspace', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultId: 'v1', vaultName: 'Arche', vaultPath: '/tmp/Arche' })

    const Home = (await import('../page')).default

    await expect(Home()).rejects.toThrow('REDIRECT:/w/local')
  })

  it('redirects web users without a session to login', async () => {
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue(null)

    const Home = (await import('../page')).default

    await expect(Home()).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects web users with a session to their dashboard', async () => {
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({ user: { slug: 'alice' } })

    const Home = (await import('../page')).default

    await expect(Home()).rejects.toThrow('REDIRECT:/u/alice')
  })
})
