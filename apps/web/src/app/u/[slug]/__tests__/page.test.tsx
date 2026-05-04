/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspacePage from '@/app/u/[slug]/page'

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const getSessionMock = vi.hoisted(() => vi.fn())
const getKickstartStatusMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const readCommonWorkspaceConfigMock = vi.hoisted(() => vi.fn())
const listRecentKbFileUpdatesMock = vi.hoisted(() => vi.fn())
const listSkillsMock = vi.hoisted(() => vi.fn())
const parseCommonWorkspaceConfigMock = vi.hoisted(() => vi.fn())
const getAgentSummariesMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/dashboard/dashboard-hero', () => ({
  DashboardHero: ({
    agents,
    recentUpdates,
    skills,
    slug,
  }: {
    agents: { displayName: string }[]
    recentUpdates: { fileName: string }[]
    skills: { name: string }[]
    slug: string
  }) => (
    <div>
      <p>Dashboard hero for {slug}</p>
      <p>Agents: {agents.map((agent) => agent.displayName).join(', ')}</p>
      <p>Updates: {recentUpdates.map((update) => update.fileName).join(', ')}</p>
      <p>Skills: {skills.map((skill) => skill.name).join(', ')}</p>
    </div>
  ),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: () => getKickstartStatusMock(),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
}))

vi.mock('@/lib/common-workspace-config-store', () => ({
  listRecentKbFileUpdates: (...args: unknown[]) => listRecentKbFileUpdatesMock(...args),
  readCommonWorkspaceConfig: () => readCommonWorkspaceConfigMock(),
}))

vi.mock('@/lib/skills/skill-store', () => ({
  listSkills: () => listSkillsMock(),
}))

vi.mock('@/lib/workspace-config', () => ({
  getAgentSummaries: (...args: unknown[]) => getAgentSummariesMock(...args),
  parseCommonWorkspaceConfig: (...args: unknown[]) => parseCommonWorkspaceConfigMock(...args),
}))

function renderWorkspacePage(setup?: string) {
  return WorkspacePage({
    params: Promise.resolve({ slug: 'alice' }),
    searchParams: Promise.resolve(setup ? { setup } : {}),
  })
}

describe('WorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getSessionMock.mockResolvedValue({ user: { role: 'ADMIN', slug: 'alice' } })
    getKickstartStatusMock.mockResolvedValue('ready')
    readCommonWorkspaceConfigMock.mockResolvedValue({ ok: true, content: 'config' })
    listRecentKbFileUpdatesMock.mockResolvedValue({
      ok: true,
      updates: [{ fileName: 'Brief.md', filePath: 'Brief.md' }],
    })
    listSkillsMock.mockResolvedValue({
      ok: true,
      data: [{ name: 'writer', description: 'Drafts text' }],
    })
    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: true, config: {} })
    getAgentSummariesMock.mockReturnValue([
      { id: 'researcher', displayName: 'Researcher', description: 'Research', isPrimary: false },
      { id: 'assistant', displayName: 'Assistant', description: 'Primary', isPrimary: true },
    ])
  })

  it('redirects desktop users to the selected desktop workspace', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultId: 'vault-1' })

    await expect(renderWorkspacePage()).rejects.toThrow('REDIRECT:/w/local')
  })

  it('renders the admin kickstart blocker when setup is required', async () => {
    getKickstartStatusMock.mockResolvedValue('needs_setup')

    render(await renderWorkspacePage('required'))

    expect(screen.getByText('Kickstart Required')).toBeTruthy()
    expect(screen.getByText('Workspace access is blocked until initial setup is completed.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Start initial setup' }).getAttribute('href')).toBe('/u/alice/kickstart')
  })

  it('renders the non-admin in-progress blocker', async () => {
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'alice' } })
    getKickstartStatusMock.mockResolvedValue('setup_in_progress')

    render(await renderWorkspacePage('in-progress'))

    expect(screen.getByText('Setup is currently running. You can open the wizard to monitor progress, but apply may be temporarily locked.')).toBeTruthy()
    expect(screen.getByText('Ask an administrator to complete kickstart setup for this workspace.')).toBeTruthy()
  })

  it('loads dashboard data for ready workspaces', async () => {
    render(await renderWorkspacePage('completed'))

    expect(screen.getByText('Kickstart setup completed. Your workspace is now ready.')).toBeTruthy()
    expect(screen.getByText('Dashboard hero for alice')).toBeTruthy()
    expect(screen.getByText('Agents: Assistant, Researcher')).toBeTruthy()
    expect(screen.getByText('Updates: Brief.md')).toBeTruthy()
    expect(screen.getByText('Skills: writer')).toBeTruthy()
    expect(listRecentKbFileUpdatesMock).toHaveBeenCalledWith(10)
  })
})
