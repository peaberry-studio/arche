/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DashboardLayout from '@/app/u/[slug]/layout'

type WorkspaceThemeProviderProps = {
  children: React.ReactNode
  initialChatFontFamily: string
  initialChatFontSize: number
  initialIsDark: boolean
  initialThemeId: string
  storageScope: string
}

type DashboardNavProps = {
  desktopMode: boolean
  displayLabel?: string
  hasWindowInset: boolean
  slug: string
}

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const cookiesMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getWorkspacePersistenceScopeMock = vi.hoisted(() => vi.fn())
const shouldUseCurrentMacOsInsetTitleBarMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const dashboardNavProps = vi.hoisted(() => ({ current: null as DashboardNavProps | null }))
const themeProviderProps = vi.hoisted(() => ({ current: null as WorkspaceThemeProviderProps | null }))

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/dashboard/dashboard-nav', () => ({
  DashboardNav: (props: DashboardNavProps) => {
    dashboardNavProps.current = props
    return <nav>Dashboard nav for {props.slug}</nav>
  },
}))

vi.mock('@/components/dashboard/dashboard-theme-shell', () => ({
  DashboardThemeShell: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}))

vi.mock('@/contexts/workspace-theme-context', () => ({
  WorkspaceThemeProvider: (props: WorkspaceThemeProviderProps) => {
    themeProviderProps.current = props
    return <div data-testid="dashboard-theme-provider">{props.children}</div>
  },
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
  getWorkspacePersistenceScope: (...args: unknown[]) => getWorkspacePersistenceScopeMock(...args),
}))

vi.mock('@/lib/runtime/desktop-window-chrome', () => ({
  shouldUseCurrentMacOsInsetTitleBar: () => shouldUseCurrentMacOsInsetTitleBarMock(),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

function renderDashboardLayout() {
  return DashboardLayout({
    children: <p>Dashboard child</p>,
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

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dashboardNavProps.current = null
    themeProviderProps.current = null
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getWorkspacePersistenceScopeMock.mockReturnValue('scope-alice')
    shouldUseCurrentMacOsInsetTitleBarMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'alice' } })
    mockCookies({})
  })

  it('redirects desktop sessions when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderDashboardLayout()).rejects.toThrow('REDIRECT:/')
  })

  it('redirects unauthenticated users to login', async () => {
    getSessionMock.mockResolvedValue(null)

    await expect(renderDashboardLayout()).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects non-admin users away from other workspaces', async () => {
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'bob' } })

    await expect(renderDashboardLayout()).rejects.toThrow('REDIRECT:/u/bob')
  })

  it('renders with persisted theme cookies and desktop chrome state', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultName: 'Client Vault' })
    shouldUseCurrentMacOsInsetTitleBarMock.mockReturnValue(true)
    getSessionMock.mockResolvedValue({ user: { role: 'ADMIN', slug: 'admin' } })
    mockCookies({
      'arche-workspace-chat-font-family-scope-alice': 'serif',
      'arche-workspace-chat-font-size-scope-alice': '18',
      'arche-workspace-dark-mode-scope-alice': 'true',
      'arche-workspace-theme-scope-alice': 'ocean-mist',
    })

    render(await renderDashboardLayout())

    expect(screen.getByText('Dashboard nav for alice')).toBeTruthy()
    expect(screen.getByText('Dashboard child')).toBeTruthy()
    expect(themeProviderProps.current).toMatchObject({
      initialChatFontFamily: 'serif',
      initialChatFontSize: 18,
      initialIsDark: true,
      initialThemeId: 'ocean-mist',
      storageScope: 'scope-alice',
    })
    expect(dashboardNavProps.current).toMatchObject({
      desktopMode: true,
      displayLabel: 'Client Vault',
      hasWindowInset: true,
      slug: 'alice',
    })
  })

  it('falls back when persisted theme cookies are invalid', async () => {
    mockCookies({
      'arche-workspace-chat-font-family-scope-alice': 'mono',
      'arche-workspace-chat-font-size-scope-alice': '99',
      'arche-workspace-dark-mode-scope-alice': 'maybe',
      'arche-workspace-theme-scope-alice': 'unknown-theme',
    })

    render(await renderDashboardLayout())

    expect(themeProviderProps.current).toMatchObject({
      initialChatFontFamily: 'sans',
      initialChatFontSize: 15,
      initialIsDark: false,
      initialThemeId: 'warm-sand',
    })
    expect(dashboardNavProps.current).toMatchObject({
      desktopMode: false,
      displayLabel: undefined,
      hasWindowInset: false,
      slug: 'alice',
    })
  })
})
