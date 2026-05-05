/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

const getRuntimeCapabilitiesMock = vi.fn()
const getSessionMock = vi.fn()
const get2FAStatusMock = vi.fn()
const isDesktopMock = vi.fn()

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ host: 'localhost:3000' })),
}))

vi.mock('@/components/settings/google-workspace-integration-panel', () => ({
  GoogleWorkspaceIntegrationPanel: ({ slug, redirectUri }: { slug: string; redirectUri: string }) => (
    <div>Google Workspace integration panel {slug} {redirectUri}</div>
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

vi.mock('../../security/actions', () => ({
  get2FAStatus: () => get2FAStatusMock(),
}))

describe('GoogleWorkspaceIntegrationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    isDesktopMock.mockReturnValue(false)
    getRuntimeCapabilitiesMock.mockReturnValue({
      googleWorkspaceIntegration: true,
      twoFactor: false,
    })
    getSessionMock.mockResolvedValue({
      user: {
        id: 'admin-1',
        role: 'ADMIN',
        slug: 'alice',
      },
      sessionId: 'session-1',
    })
    get2FAStatusMock.mockResolvedValue({ ok: true })
  })

  it('renders the dedicated Google Workspace integration page for admins', async () => {
    const Page = (await import('./page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByRole('heading', { name: 'Google Workspace integration' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to integrations/ }).getAttribute('href')).toBe('/u/alice/settings?section=integrations')
    expect(screen.getByText('Google Workspace integration panel alice http://localhost:3000/api/connectors/oauth/callback')).toBeTruthy()
  })

  it('redirects non-admin users back to settings integrations', async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: 'user-1',
        role: 'USER',
        slug: 'alice',
      },
      sessionId: 'session-1',
    })

    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow(
      'REDIRECT:/u/alice/settings?section=integrations',
    )
  })

  it('redirects unauthenticated users to login', async () => {
    getSessionMock.mockResolvedValue(null)

    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects when 2FA status cannot be loaded', async () => {
    getRuntimeCapabilitiesMock.mockReturnValue({
      googleWorkspaceIntegration: true,
      twoFactor: true,
    })
    get2FAStatusMock.mockResolvedValue({ ok: false, error: 'unauthorized' })

    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects when googleWorkspaceIntegration capability is disabled', async () => {
    getRuntimeCapabilitiesMock.mockReturnValue({
      googleWorkspaceIntegration: false,
      twoFactor: false,
    })

    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow(
      'REDIRECT:/u/alice/settings?section=integrations',
    )
  })

  it('redirects desktop users to settings integrations', async () => {
    isDesktopMock.mockReturnValue(true)

    const Page = (await import('./page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow(
      'REDIRECT:/u/alice/settings?section=integrations',
    )
  })
})
