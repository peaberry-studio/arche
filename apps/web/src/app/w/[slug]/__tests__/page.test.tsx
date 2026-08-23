/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspaceHostPage from '@/app/w/[slug]/page'

type WorkspaceShellProps = {
  currentVault: { id: string; name: string; path: string } | null
  initialLayoutState: unknown
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
const ensureFlowSchedulerStartedMock = vi.hoisted(() => vi.fn())
const getRuntimeCapabilitiesMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getWorkspacePersistenceScopeMock = vi.hoisted(() => vi.fn())
const shouldUseCurrentMacOsInsetTitleBarMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const getKickstartStatusMock = vi.hoisted(() => vi.fn())
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

vi.mock('@/lib/flows/scheduler-bootstrap', () => ({
  ensureFlowSchedulerStarted: () => ensureFlowSchedulerStartedMock(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
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

vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: () => getKickstartStatusMock(),
}))

vi.mock('@/lib/workspace-panel-state', () => ({
  getWorkspaceLayoutCookieName: (scope: string) => `layout:${scope}`,
  parseWorkspaceLayoutState: (...args: unknown[]) => parseWorkspaceLayoutStateMock(...args),
}))

function renderHostPage(search?: { flowId?: string; flows?: string; mode?: string; path?: string; session?: string; settings?: string }) {
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
    ensureFlowSchedulerStartedMock.mockResolvedValue(undefined)
    getRuntimeCapabilitiesMock.mockReturnValue({ workspaceAgent: true, reaper: false })
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getWorkspacePersistenceScopeMock.mockReturnValue('scope-alice')
    shouldUseCurrentMacOsInsetTitleBarMock.mockReturnValue(true)
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'alice' } })
    getKickstartStatusMock.mockResolvedValue('ready')
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

  it('redirects legacy knowledge file links to the Explore page keeping the session', async () => {
    await expect(renderHostPage({
      mode: 'knowledge',
      path: 'Notes/Brief.md',
      session: 'session-1',
    })).rejects.toThrow('REDIRECT:/w/alice/explore?path=Notes%2FBrief.md&session=session-1')
  })

  it('redirects legacy Explore mode links to the Explore page', async () => {
    await expect(renderHostPage({ mode: 'explore', path: 'Notes/Brief.md' }))
      .rejects.toThrow('REDIRECT:/w/alice/explore?path=Notes%2FBrief.md')
    await expect(renderHostPage({ mode: 'explore' }))
      .rejects.toThrow('REDIRECT:/w/alice/explore')
  })

  it('redirects bare path links to the Explore page', async () => {
    await expect(renderHostPage({ path: 'Notes/Brief.md' }))
      .rejects.toThrow('REDIRECT:/w/alice/explore?path=Notes%2FBrief.md')
  })

  it('redirects legacy knowledge mode links to the chat view', async () => {
    await expect(renderHostPage({ mode: 'knowledge', session: 'session-1' }))
      .rejects.toThrow('REDIRECT:/w/alice?session=session-1')
  })

  it('redirects legacy flows mode links to the flows overlay', async () => {
    await expect(renderHostPage({ mode: 'flows' })).rejects.toThrow('REDIRECT:/w/alice?flows=list')
  })

  it('redirects flows mode session links to the chat view without the overlay (session wins)', async () => {
    await expect(renderHostPage({
      mode: 'flows',
      session: 'session-1',
      path: 'Notes/Brief.md',
      flowId: 'flow-1',
    })).rejects.toThrow(
      'REDIRECT:/w/alice?session=session-1&path=Notes%2FBrief.md&flowId=flow-1'
    )
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
      mode: 'flows',
      path: 'Notes/Brief.md',
      session: 'session-1',
    }))

    expect(screen.getByText('Workspace shell for alice')).toBeTruthy()
    expect(ensureFlowSchedulerStartedMock).toHaveBeenCalled()
    expect(workspaceShellProps.current).toMatchObject({
      currentVault: { id: 'vault-1', name: 'Arche Vault', path: '/tmp/arche' },
      initialLayoutState: { layout: 'parsed' },
      macDesktopWindowInset: true,
      persistenceScope: 'scope-alice',
      reaperEnabled: false,
      workspaceAgentEnabled: true,
    })
    expect(getWorkspacePersistenceScopeMock).toHaveBeenCalledWith('alice')
    expect(parseWorkspaceLayoutStateMock).toHaveBeenCalledWith('layout-cookie')
  })
})
