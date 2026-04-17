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
const ensureSlackServiceUserMock = vi.fn()

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/settings/slack-integration-settings-content', () => ({
  SlackIntegrationSettingsContent: ({ slug, showProviderCredentials }: { slug: string; showProviderCredentials?: boolean }) => (
    <div>Slack integration settings content {slug} {String(showProviderCredentials)}</div>
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

vi.mock('@/lib/slack/service-user', () => ({
  ensureSlackServiceUser: () => ensureSlackServiceUserMock(),
}))

vi.mock('../../security/actions', () => ({
  get2FAStatus: () => get2FAStatusMock(),
}))

describe('SlackIntegrationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    isDesktopMock.mockReturnValue(false)
    getRuntimeCapabilitiesMock.mockReturnValue({
      slackIntegration: true,
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
    ensureSlackServiceUserMock.mockResolvedValue({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })
  })

  it('renders the dedicated Slack integration page for admins', async () => {
    const Page = (await import('./page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByRole('heading', { name: 'Slack integration' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to integrations/ }).getAttribute('href')).toBe('/u/alice/settings?section=integrations')
    expect(screen.getByText('Slack integration settings content alice true')).toBeTruthy()
    expect(ensureSlackServiceUserMock).toHaveBeenCalledTimes(1)
  })

  it('hides provider credentials when the reserved service user cannot be provisioned', async () => {
    ensureSlackServiceUserMock.mockResolvedValue({ ok: false, error: 'service_user_conflict' })

    const Page = (await import('./page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByText('Slack integration settings content alice false')).toBeTruthy()
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
})
