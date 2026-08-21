/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspaceExplorePage from '@/app/w/[slug]/explore/page'

type ExploreShellProps = {
  currentVault: { id: string; name: string; path: string } | null
  initialFilePath: string | null
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
const ensureFlowSchedulerStartedMock = vi.hoisted(() => vi.fn())
const readCommonWorkspaceConfigMock = vi.hoisted(() => vi.fn())
const getRuntimeCapabilitiesMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getWorkspacePersistenceScopeMock = vi.hoisted(() => vi.fn())
const shouldUseCurrentMacOsInsetTitleBarMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const getKickstartStatusMock = vi.hoisted(() => vi.fn())
const parseCommonWorkspaceConfigMock = vi.hoisted(() => vi.fn())
const getAgentSummariesMock = vi.hoisted(() => vi.fn())
const exploreShellProps = vi.hoisted(() => ({ current: undefined as ExploreShellProps | undefined }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/workspace/explore-shell', () => ({
  ExploreShell: (props: ExploreShellProps) => {
    exploreShellProps.current = props
    return <div>Explore shell for {props.slug}</div>
  },
}))

vi.mock('@/lib/flows/scheduler-bootstrap', () => ({
  ensureFlowSchedulerStarted: () => ensureFlowSchedulerStartedMock(),
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

function renderExplorePage(search?: { path?: string }) {
  return WorkspaceExplorePage({
    params: Promise.resolve({ slug: 'alice' }),
    searchParams: Promise.resolve(search ?? {}),
  })
}

describe('WorkspaceExplorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exploreShellProps.current = undefined
    ensureFlowSchedulerStartedMock.mockResolvedValue(undefined)
    readCommonWorkspaceConfigMock.mockResolvedValue({ ok: true, content: 'config' })
    getRuntimeCapabilitiesMock.mockReturnValue({ workspaceAgent: true, reaper: false })
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getWorkspacePersistenceScopeMock.mockReturnValue('scope-alice')
    shouldUseCurrentMacOsInsetTitleBarMock.mockReturnValue(true)
    isDesktopMock.mockReturnValue(false)
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'alice' } })
    getKickstartStatusMock.mockResolvedValue('ready')
    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: true, config: {} })
    getAgentSummariesMock.mockReturnValue([
      { id: 'assistant', displayName: 'Assistant', prompt: 'Help users' },
    ])
  })

  it('redirects desktop mode when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderExplorePage()).rejects.toThrow('REDIRECT:/')
  })

  it('redirects unauthenticated and unauthorized users', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    await expect(renderExplorePage()).rejects.toThrow('REDIRECT:/login')

    getSessionMock.mockResolvedValueOnce({ user: { role: 'USER', slug: 'bob' } })
    await expect(renderExplorePage()).rejects.toThrow('REDIRECT:/w/bob')
  })

  it('redirects when kickstart setup is not ready', async () => {
    getKickstartStatusMock.mockResolvedValue('needs_setup')

    await expect(renderExplorePage()).rejects.toThrow('REDIRECT:/u/alice?setup=required')
  })

  it('renders the explore shell with the initial file path', async () => {
    render(await renderExplorePage({ path: 'Notes/Brief.md' }))

    expect(screen.getByText('Explore shell for alice')).toBeTruthy()
    expect(exploreShellProps.current).toMatchObject({
      initialFilePath: 'Notes/Brief.md',
      persistenceScope: 'scope-alice',
      workspaceAgentEnabled: true,
      reaperEnabled: false,
      macDesktopWindowInset: true,
    })
    expect(exploreShellProps.current?.knowledgeAgentSources).toEqual([
      { id: 'assistant', displayName: 'Assistant', prompt: 'Help users' },
    ])
  })

  it('renders without a path', async () => {
    render(await renderExplorePage())

    expect(exploreShellProps.current?.initialFilePath).toBeNull()
  })
})
