/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPage from '@/app/u/[slug]/settings/page'

type CapturedSettingsPageProps = {
  availableSections: string[]
  currentSection: string
  enabled: boolean
  googleWorkspaceSummary: unknown
  passwordChangeEnabled: boolean
  recoveryCodesRemaining: number
  releaseVersion: string
  slackIntegrationSummary: unknown
  slug: string
  twoFactorEnabled: boolean
  verifiedAt: Date | null
}

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const getRuntimeCapabilitiesMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getDesktopWorkspaceHrefMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const get2FAStatusMock = vi.hoisted(() => vi.fn())
const serializeSlackIntegrationMock = vi.hoisted(() => vi.fn())
const findSlackIntegrationMock = vi.hoisted(() => vi.fn())
const decryptGoogleWorkspaceConfigMock = vi.hoisted(() => vi.fn())
const ensureGoogleWorkspaceSeededMock = vi.hoisted(() => vi.fn())
const settingsPageProps = vi.hoisted(() => ({ current: null as CapturedSettingsPageProps | null }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/app/u/[slug]/settings/security/actions', () => ({
  get2FAStatus: () => get2FAStatusMock(),
}))

vi.mock('@/app/u/[slug]/settings/settings-page-content', () => ({
  SettingsPageContent: (props: CapturedSettingsPageProps) => {
    settingsPageProps.current = props
    return <div>Settings page content {props.slug} {props.currentSection}</div>
  },
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
  getDesktopWorkspaceHref: (...args: unknown[]) => getDesktopWorkspaceHrefMock(...args),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

vi.mock('@/lib/services', () => ({
  googleWorkspaceService: {
    decryptIntegrationConfig: (...args: unknown[]) => decryptGoogleWorkspaceConfigMock(...args),
    ensureIntegrationSeededFromEnv: () => ensureGoogleWorkspaceSeededMock(),
  },
  slackService: {
    findIntegration: () => findSlackIntegrationMock(),
  },
}))

vi.mock('@/lib/slack/integration', () => ({
  serializeSlackIntegration: (...args: unknown[]) => serializeSlackIntegrationMock(...args),
}))

function renderSettingsPage(searchParams?: { section?: string | string[] }) {
  return SettingsPage({
    params: Promise.resolve({ slug: 'alice' }),
    searchParams: Promise.resolve(searchParams ?? {}),
  })
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ARCHE_GIT_SHA', '')
    vi.stubEnv('ARCHE_RELEASE_VERSION', '')
    settingsPageProps.current = null
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getDesktopWorkspaceHrefMock.mockReturnValue('/w/local?settings=appearance')
    getSessionMock.mockResolvedValue({ user: { role: 'ADMIN', slug: 'alice' } })
    getRuntimeCapabilitiesMock.mockReturnValue({
      auth: true,
      googleWorkspaceIntegration: true,
      slackIntegration: true,
      twoFactor: true,
    })
    get2FAStatusMock.mockResolvedValue({
      ok: true,
      enabled: true,
      recoveryCodesRemaining: 4,
      verifiedAt: new Date('2026-04-20T10:00:00.000Z'),
    })
    findSlackIntegrationMock.mockResolvedValue({ id: 'slack-1' })
    serializeSlackIntegrationMock.mockReturnValue({ configured: true, status: 'connected' })
    ensureGoogleWorkspaceSeededMock.mockResolvedValue({
      updatedAt: new Date('2026-04-21T10:00:00.000Z'),
      version: 3,
    })
    decryptGoogleWorkspaceConfigMock.mockReturnValue({ clientId: 'google-client', clientSecret: 'secret' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects desktop users to the desktop appearance panel', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultName: 'Client Vault' })

    await expect(renderSettingsPage()).rejects.toThrow('REDIRECT:/w/local?settings=appearance')
    expect(getDesktopWorkspaceHrefMock).toHaveBeenCalledWith('local', 'appearance')
  })

  it('redirects desktop users when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderSettingsPage()).rejects.toThrow('REDIRECT:/')
  })

  it('redirects unauthenticated users', async () => {
    getSessionMock.mockResolvedValue(null)

    await expect(renderSettingsPage()).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects when 2FA status cannot be loaded', async () => {
    get2FAStatusMock.mockResolvedValue({ ok: false, error: 'unauthorized' })

    await expect(renderSettingsPage()).rejects.toThrow('REDIRECT:/login')
  })

  it('renders admin settings with loaded integration summaries', async () => {
    vi.stubEnv('ARCHE_GIT_SHA', 'sha-123')

    render(await renderSettingsPage({ section: ['integrations', 'security'] }))

    expect(screen.getByText('Settings page content alice integrations')).toBeTruthy()
    expect(settingsPageProps.current).toMatchObject({
      availableSections: ['general', 'integrations', 'security'],
      currentSection: 'integrations',
      enabled: true,
      googleWorkspaceSummary: {
        clientId: 'google-client',
        configured: true,
        hasClientSecret: true,
        updatedAt: '2026-04-21T10:00:00.000Z',
        version: 3,
      },
      passwordChangeEnabled: true,
      recoveryCodesRemaining: 4,
      releaseVersion: 'sha-123',
      slackIntegrationSummary: { configured: true, status: 'connected' },
      twoFactorEnabled: true,
    })
    expect(findSlackIntegrationMock).toHaveBeenCalledTimes(1)
    expect(ensureGoogleWorkspaceSeededMock).toHaveBeenCalledTimes(1)
  })

  it('skips admin-only summaries for regular users', async () => {
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'alice' } })
    getRuntimeCapabilitiesMock.mockReturnValue({
      auth: false,
      googleWorkspaceIntegration: true,
      slackIntegration: true,
      twoFactor: false,
    })

    render(await renderSettingsPage({ section: 'integrations' }))

    expect(settingsPageProps.current).toMatchObject({
      availableSections: ['general'],
      currentSection: 'general',
      passwordChangeEnabled: false,
      releaseVersion: 'dev',
      twoFactorEnabled: false,
    })
    expect(findSlackIntegrationMock).not.toHaveBeenCalled()
    expect(ensureGoogleWorkspaceSeededMock).not.toHaveBeenCalled()
  })
})
