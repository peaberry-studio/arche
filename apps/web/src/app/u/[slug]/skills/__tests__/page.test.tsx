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

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/skills/skills-page', () => ({
  SkillsPageClient: ({ slug, isAdmin }: { slug: string; isAdmin: boolean }) => (
    <div data-testid="skills-page-client">{slug} {String(isAdmin)}</div>
  ),
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

describe('SkillsPage', () => {
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

  it('redirects desktop users with a vault to the workspace skills page', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultId: 'v1', vaultName: 'Arche', vaultPath: '/tmp/Arche' })
    getDesktopWorkspaceHrefMock.mockReturnValue('/w/alice/skills')

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/w/alice/skills')
  })

  it('renders SkillsPageClient for admin web users', async () => {
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByTestId('skills-page-client').textContent).toBe('alice true')
  })

  it('renders SkillsPageClient for non-admin web users', async () => {
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'USER', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByTestId('skills-page-client').textContent).toBe('alice false')
  })
})
