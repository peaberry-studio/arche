/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
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
}))

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
  beforeEach(() => {
    vi.clearAllMocks()
    themeProviderProps.current = null
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getWorkspacePersistenceScopeMock.mockReturnValue('scope-alice')
    mockCookies({})
  })

  it('redirects desktop mode when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderWorkspaceLayout()).rejects.toThrow('REDIRECT:/')
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
    expect(themeProviderProps.current).toMatchObject({
      initialChatFontFamily: 'serif',
      initialChatFontSize: 17,
      initialIsDark: false,
      initialThemeId: 'forest-dew',
      storageScope: 'scope-alice',
    })
    expect(getWorkspacePersistenceScopeMock).toHaveBeenCalledWith('alice')
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
