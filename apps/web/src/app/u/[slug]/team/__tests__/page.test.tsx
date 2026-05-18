/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

const isDesktopMock = vi.fn()
const getCurrentDesktopVaultMock = vi.fn()
const getDesktopWorkspaceHrefMock = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
  getDesktopWorkspaceHref: (...args: string[]) => getDesktopWorkspaceHrefMock(...args),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

describe('TeamPage', () => {
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

  it('redirects web users to the team settings section', async () => {
    isDesktopMock.mockReturnValue(false)

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow(
      'REDIRECT:/u/alice/settings?section=team',
    )
  })
})
