/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspaceHostPage from '@/app/w/[slug]/page'

type WorkspaceShellProps = {
  currentVault: { id: string; name: string; path: string } | null
  initialFilePath: string | null
  initialLayoutState: unknown
  initialSessionId: string | null
  initialWorkspaceMode: string
  knowledgeAgentSources: { displayName: string; id: string; prompt: string }[]
  macDesktopWindowInset: boolean
  persistenceScope: string
  reaperEnabled: boolean
  slug: string
  workspaceAgentEnabled: boolean
}

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const cookiesMock = vi.hoisted(() => vi.fn())
const ensureAutopilotSchedulerStartedMock = vi.hoisted(() => vi.fn())
const readCommonWorkspaceConfigMock = vi.hoisted(() => vi.fn())
const getRuntimeCapabilitiesMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getWorkspacePersistenceScopeMock = vi.hoisted(() => vi.fn())
const isDesktopSettingsSectionMock = vi.hoisted(() => vi.fn())
const shouldUseCurrentMacOsInsetTitleBarMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const getKickstartStatusMock = vi.hoisted(() => vi.fn())
const parseCommonWorkspaceConfigMock = vi.hoisted(() => vi.fn())
const getAgentSummariesMock = vi.hoisted(() => vi.fn())
const parseWorkspaceLayoutStateMock = vi.hoisted(() => vi.fn())
const workspaceShellProps = vi.hoisted(() => ({ current: undefined as WorkspaceShellProps | undefined }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}))

vi.mock('@/components/workspace/workspace-shell', () => ({
  WorkspaceShell: (props: WorkspaceShellProps) => {
    workspaceShellProps.current = props
    return <div>Workspace shell for {props.slug}</div>
  },
}))

vi.mock('@/components/desktop/desktop-settings-dialog', () => ({
  DesktopSettingsDialog: ({ currentSection }: { currentSection: string | null }) => (
    <div>Desktop settings: {currentSection ?? 'none'}</div>
  ),
}))

vi.mock('@/lib/autopilot/scheduler-bootstrap', () => ({
  ensureAutopilotSchedulerStarted: () => ensureAutopilotSchedulerStartedMock(),
}))

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: () => readCommonWorkspaceConfigMock(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
  getWorkspacePersistenceScope: (...args: unknown[]) => getWorkspacePersistenceScopeMock(...args),
  isDesktopSettingsSection: (...args: unknown[]) => isDesktopSettingsSectionMock(...args),
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

vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: () => getKickstartStatusMock(),
}))

vi.mock('@/lib/workspace-config', () => ({
  getAgentSummaries: (...args: unknown[]) => getAgentSummariesMock(...args),
  parseCommonWorkspaceConfig: (...args: unknown[]) => parseCommonWorkspaceConfigMock(...args),
}))

vi.mock('@/lib/workspace-panel-state', () => ({
  getWorkspaceLayoutCookieName: (scope: string) => `layout:${scope}`,
  parseWorkspaceLayoutState: (...args: unknown[]) => parseWorkspaceLayoutStateMock(...args),
}))

function renderHostPage(search?: { mode?: string; path?: string; session?: string; settings?: string }) {
  return WorkspaceHostPage({
    params: Promise.resolve({ slug: 'alice' }),
    searchParams: Promise.resolve(search ?? {}),
  })
}

describe('WorkspaceHostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceShellProps.current = undefined
    cookiesMock.mockResolvedValue({
      get: (name: string) => {
        if (name === 'layout:scope-alice') return { value: 'layout-cookie' }
        return undefined
      },
    })
    ensureAutopilotSchedulerStartedMock.mockResolvedValue(undefined)
    readCommonWorkspaceConfigMock.mockResolvedValue({ ok: true, content: 'config' })
    getRuntimeCapabilitiesMock.mockReturnValue({ workspaceAgent: true, reaper: false })
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getWorkspacePersistenceScopeMock.mockReturnValue('scope-alice')
    isDesktopSettingsSectionMock.mockReturnValue(true)
    shouldUseCurrentMacOsInsetTitleBarMock.mockReturnValue(true)
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'alice' } })
    getKickstartStatusMock.mockResolvedValue('ready')
    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: true, config: {} })
    getAgentSummariesMock.mockReturnValue([
      { id: 'assistant', displayName: 'Assistant', prompt: 'Help users' },
    ])
    parseWorkspaceLayoutStateMock.mockReturnValue({ layout: 'parsed' })
  })

  it('redirects desktop mode when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderHostPage()).rejects.toThrow('REDIRECT:/')
  })

  it('redirects unauthenticated and unauthorized users', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    await expect(renderHostPage()).rejects.toThrow('REDIRECT:/login')

    getSessionMock.mockResolvedValueOnce({ user: { role: 'USER', slug: 'bob' } })
    await expect(renderHostPage()).rejects.toThrow('REDIRECT:/w/bob')
  })

  it('redirects when kickstart setup is not ready', async () => {
    getKickstartStatusMock.mockResolvedValue('needs_setup')

    await expect(renderHostPage()).rejects.toThrow('REDIRECT:/u/alice?setup=required')
  })

  it('renders workspace shell with persisted desktop state', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({
      vaultId: 'vault-1',
      vaultName: 'Arche Vault',
      vaultPath: '/tmp/arche',
    })

    render(await renderHostPage({
      mode: 'tasks',
      path: 'Notes/Brief.md',
      session: 'session-1',
      settings: 'appearance',
    }))

    expect(screen.getByText('Workspace shell for alice')).toBeTruthy()
    expect(screen.getByText('Desktop settings: appearance')).toBeTruthy()
    expect(ensureAutopilotSchedulerStartedMock).toHaveBeenCalled()
    expect(workspaceShellProps.current).toMatchObject({
      currentVault: { id: 'vault-1', name: 'Arche Vault', path: '/tmp/arche' },
      initialFilePath: 'Notes/Brief.md',
      initialLayoutState: { layout: 'parsed' },
      initialSessionId: 'session-1',
      initialWorkspaceMode: 'chat',
      knowledgeAgentSources: [{ id: 'assistant', displayName: 'Assistant', prompt: 'Help users' }],
      macDesktopWindowInset: true,
      persistenceScope: 'scope-alice',
      reaperEnabled: false,
      workspaceAgentEnabled: true,
    })
    expect(getWorkspacePersistenceScopeMock).toHaveBeenCalledWith('alice')
    expect(parseWorkspaceLayoutStateMock).toHaveBeenCalledWith('layout-cookie')
  })
})
