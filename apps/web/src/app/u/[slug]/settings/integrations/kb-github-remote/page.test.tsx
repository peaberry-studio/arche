/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

const decryptIntegrationConfigMock = vi.fn()
const findIntegrationMock = vi.fn()
const get2FAStatusMock = vi.fn()
const getRuntimeCapabilitiesMock = vi.fn()
const getSessionMock = vi.fn()
const isDesktopMock = vi.fn()
const toSummaryMock = vi.fn()

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/settings/kb-github-remote-panel', () => ({
  KbGithubRemotePanel: ({ initialIntegration, slug }: { initialIntegration: { connected: boolean }; slug: string }) => (
    <div>KB GitHub remote panel {slug} {String(initialIntegration.connected)}</div>
  ),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

vi.mock('@/lib/services', () => ({
  kbGithubRemoteService: {
    decryptIntegrationConfig: decryptIntegrationConfigMock,
    findIntegration: findIntegrationMock,
    toSummary: toSummaryMock,
  },
}))

vi.mock('../../security/actions', () => ({
  get2FAStatus: () => get2FAStatusMock(),
}))

describe('KbGithubRemoteSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    isDesktopMock.mockReturnValue(false)
    getRuntimeCapabilitiesMock.mockReturnValue({
      kbGithubRemoteIntegration: true,
      twoFactor: false,
    })
    getSessionMock.mockResolvedValue({
      sessionId: 'session-1',
      user: {
        id: 'admin-1',
        role: 'ADMIN',
        slug: 'alice',
      },
    })
    get2FAStatusMock.mockResolvedValue({ ok: true })
    findIntegrationMock.mockResolvedValue({ id: 'integration-1' })
    decryptIntegrationConfigMock.mockReturnValue({ owner: 'acme' })
    toSummaryMock.mockReturnValue({ connected: true })
  })

  it('renders the dedicated GitHub KB sync page for admins', async () => {
    const Page = (await import('./page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByRole('heading', { name: 'GitHub KB sync' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to integrations/ }).getAttribute('href')).toBe('/u/alice/settings?section=integrations')
    expect(screen.getByText('KB GitHub remote panel alice true')).toBeTruthy()
    expect(toSummaryMock).toHaveBeenCalledWith({ id: 'integration-1' }, { owner: 'acme' })
  })

  it('redirects unauthenticated users to login', async () => {
    getSessionMock.mockResolvedValue(null)
    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects when 2FA status cannot be loaded', async () => {
    getRuntimeCapabilitiesMock.mockReturnValue({
      kbGithubRemoteIntegration: true,
      twoFactor: true,
    })
    get2FAStatusMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects non-admins and disabled deployments back to integrations', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session-1',
      user: {
        id: 'user-1',
        role: 'USER',
        slug: 'alice',
      },
    })
    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice/settings?section=integrations')

    getSessionMock.mockResolvedValue({
      sessionId: 'session-1',
      user: {
        id: 'admin-1',
        role: 'ADMIN',
        slug: 'alice',
      },
    })
    getRuntimeCapabilitiesMock.mockReturnValue({
      kbGithubRemoteIntegration: false,
      twoFactor: false,
    })

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice/settings?section=integrations')
  })

  it('redirects desktop users back to settings integrations', async () => {
    isDesktopMock.mockReturnValue(true)
    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice/settings?section=integrations')
  })
})
