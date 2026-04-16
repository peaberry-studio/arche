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

vi.mock('@/components/providers/provider-credentials-panel', () => ({
  ProviderCredentialsPanel: ({ slug, title }: { slug: string; title: string }) => <div>{title} {slug}</div>,
}))

vi.mock('@/components/settings/slack-integration-panel', () => ({
  SlackIntegrationPanel: ({ slug, collapsible }: { slug: string; collapsible?: boolean }) => (
    <div>Slack integration panel {slug} {String(collapsible)}</div>
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
  })

  it('renders the dedicated Slack integration page for admins', async () => {
    const Page = (await import('./page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByRole('heading', { name: 'Slack integration' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to integrations/ }).getAttribute('href')).toBe('/u/alice/settings?section=integrations')
    expect(screen.getByText('Slack integration panel alice false')).toBeTruthy()
    expect(screen.getByText('Provider credentials for Slack bot slack-bot')).toBeTruthy()
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
