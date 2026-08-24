/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspaceLayout from '@/app/w/[slug]/layout'

type WorkspaceThemeProviderProps = {
  children: React.ReactNode
  initialChatFontFamily: string
  initialChatFontSize: number
  initialIsDark: boolean
  initialThemeId: string
  storageScope: string
}

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const cookiesMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getWorkspacePersistenceScopeMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const themeProviderProps = vi.hoisted(() => ({ current: null as WorkspaceThemeProviderProps | null }))

vi.mock('@/contexts/workspace-runtime-context', () => ({
  WorkspaceRuntimeProvider: (props: { children: React.ReactNode; slug: string; persistenceScope: string }) => {
    return <div data-testid="workspace-runtime-provider" data-slug={props.slug}>{props.children}</div>
  },
}))

vi.mock('@/components/workspace/workspace-app-chrome', () => ({
    WorkspaceAppChrome: (props: { children: React.ReactNode; slug: string }) => {
      return <div data-testid="workspace-app-chrome" data-slug={props.slug}>{props.children}</div>
    },
  }))

vi.mock('@/components/workspace/workspace-settings-dialog', () => ({
  WorkspaceSettingsDialog: () => <div data-testid="workspace-settings-dialog" />,
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

vi.mock('@/actions/two-factor', () => ({
  get2FAStatus: () => get2FAStatusMock(),
}))

vi.mock('@/lib/two-factor-status', () => ({
  normalizeTwoFactorStatus: (status: unknown) =>
    (status && typeof status === 'object' && 'ok' in status && (status as { ok: boolean }).ok)
      ? { enabled: false, verifiedAt: null, recoveryCodesRemaining: 0 }
      : { enabled: false, verifiedAt: null, recoveryCodesRemaining: 0 },
}))

vi.mock('@/lib/slack/service-user', () => ({
  ensureSlackServiceUser: () => ensureSlackServiceUserMock(),
}))

vi.mock('@/lib/services', () => ({
  slackService: { findIntegration: () => Promise.resolve(null) },
  googleWorkspaceService: {
    ensureIntegrationSeededFromEnv: () => Promise.resolve(null),
    decryptIntegrationConfig: () => null,
  },
  kbGithubRemoteService: {
    findIntegration: () => Promise.resolve(null),
    decryptIntegrationConfig: () => null,
    toSummary: () => null,
  },
}))

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
  headers: () => new Headers(),
}))

vi.mock('@/lib/http', () => ({
  getPublicBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/contexts/workspace-theme-context', () => ({
  WorkspaceThemeProvider: (props: WorkspaceThemeProviderProps) => {
    themeProviderProps.current = props
    return <div data-testid="workspace-theme-provider">{props.children}</div>
  },
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
  getWorkspacePersistenceScope: (...args: unknown[]) => getWorkspacePersistenceScopeMock(...args),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
  getRuntimeMode: () => 'web',
}))

const getRuntimeCapabilitiesMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

const getSessionMock = vi.hoisted(() => vi.fn())
const get2FAStatusMock = vi.hoisted(() => vi.fn())
const ensureSlackServiceUserMock = vi.hoisted(() => vi.fn())

function renderWorkspaceLayout() {
  return WorkspaceLayout({
    children: <p>Workspace child</p>,
    params: Promise.resolve({ slug: 'alice' }),
  })
}

function mockCookies(values: Record<string, string>) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => {
      const value = values[name]
      return value ? { value } : undefined
    },
  })
}

describe('WorkspaceLayout', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    themeProviderProps.current = null
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getWorkspacePersistenceScopeMock.mockReturnValue('scope-alice')
    getRuntimeCapabilitiesMock.mockReturnValue({ reaper: true, twoFactor: false, slackIntegration: false, googleWorkspaceIntegration: false, kbGithubRemoteIntegration: false, connectors: true, teamManagement: true, auth: true })
    getSessionMock.mockResolvedValue({
      user: {
        id: 'user-1',
        slug: 'alice',
        role: 'ADMIN',
        email: 'alice@example.com',
        name: 'Alice',
      },
    })
    get2FAStatusMock.mockResolvedValue(null)
    ensureSlackServiceUserMock.mockResolvedValue({ ok: true, user: { id: 'svc-1', slug: 'slack-bot' } })
    mockCookies({})
  })

  it('redirects desktop mode when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderWorkspaceLayout()).rejects.toThrow('REDIRECT:/')
  })

  it('redirects a non-owner to their own workspace', async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: 'user-2',
        slug: 'bob',
        role: 'USER',
        email: 'bob@example.com',
        name: 'Bob',
      },
    })

    await expect(renderWorkspaceLayout()).rejects.toThrow('REDIRECT:/w/bob')
  })

  it('lets an admin open another user workspace', async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: 'user-2',
        slug: 'bob',
        role: 'ADMIN',
        email: 'bob@example.com',
        name: 'Bob',
      },
    })

    render(await renderWorkspaceLayout())

    expect(screen.getByText('Workspace child')).toBeTruthy()
  })

  it('renders with persisted workspace theme values', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultName: 'Client Vault' })
    mockCookies({
      'arche-workspace-chat-font-family-scope-alice': 'serif',
      'arche-workspace-chat-font-size-scope-alice': '17',
      'arche-workspace-dark-mode-scope-alice': 'false',
      'arche-workspace-theme-scope-alice': 'forest-dew',
    })

    render(await renderWorkspaceLayout())

    expect(screen.getByText('Workspace child')).toBeTruthy()
    expect(screen.getByTestId('workspace-runtime-provider')).toBeTruthy()
    expect(themeProviderProps.current).toMatchObject({
      initialChatFontFamily: 'serif',
      initialChatFontSize: 17,
      initialIsDark: false,
      initialThemeId: 'forest-dew',
      storageScope: 'scope-alice',
    })
    expect(getWorkspacePersistenceScopeMock).toHaveBeenCalledWith('alice')
  })

  it('mounts the shared chrome and the settings dialog on web (no desktop vault)', async () => {
    render(await renderWorkspaceLayout())

    expect(screen.getByTestId('workspace-runtime-provider')).toBeTruthy()
    expect(screen.getByTestId('workspace-app-chrome')).toBeTruthy()
    expect(screen.getByText('Workspace child')).toBeTruthy()
    expect(screen.getByTestId('workspace-settings-dialog')).toBeTruthy()
  })

  it('falls back to default theme values for invalid cookies', async () => {
    mockCookies({
      'arche-workspace-chat-font-family-scope-alice': 'mono',
      'arche-workspace-chat-font-size-scope-alice': '13',
      'arche-workspace-dark-mode-scope-alice': 'auto',
      'arche-workspace-theme-scope-alice': 'invalid',
    })

    render(await renderWorkspaceLayout())

    expect(themeProviderProps.current).toMatchObject({
      initialChatFontFamily: 'sans',
      initialChatFontSize: 15,
      initialIsDark: false,
      initialThemeId: 'warm-sand',
    })
  })
})
