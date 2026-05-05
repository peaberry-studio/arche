/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsPageClient } from '@/components/skills/skills-page'
import type { AgentListItem } from '@/hooks/use-agents-catalog'
import type { SkillListItem } from '@/hooks/use-skills-catalog'

const reloadMock = vi.fn(async () => {})
const mockAgentsState: { agents: AgentListItem[] } = { agents: [] }
const mockSkillsState: {
  hash?: string | null
  isLoading: boolean
  loadError: string | null
  skills: SkillListItem[]
} = {
  hash: 'hash-1',
  isLoading: false,
  loadError: null,
  skills: [],
}

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: () => ({ agents: mockAgentsState.agents, isLoading: false, loadError: null, reload: vi.fn() }),
}))

vi.mock('@/hooks/use-skills-catalog', () => ({
  useSkillsCatalog: () => ({ ...mockSkillsState, reload: reloadMock }),
}))

vi.mock('@/components/skills/import-skill-dialog', () => ({
  ImportSkillDialog: ({ open, agents, expectedHash, onImported }: {
    agents: { id: string; displayName: string; isPrimary: boolean }[]
    expectedHash?: string | null
    onImported: () => void | Promise<void>
    open: boolean
  }) => (
    <div data-testid="import-dialog">
      {open ? 'open' : 'closed'} {expectedHash} {agents.map((agent) => agent.displayName).join(',')}
      <button type="button" onClick={() => void onImported()}>Imported</button>
    </div>
  ),
}))

vi.mock('@/components/skills/skills-list', () => ({
  SkillsList: ({ skills }: { skills: SkillListItem[] }) => <div data-testid="skills-list">{skills.map((skill) => skill.name).join(',')}</div>,
}))

beforeEach(() => {
  reloadMock.mockClear()
  mockAgentsState.agents = [{ id: 'agent-1', displayName: 'Primary Agent', isPrimary: true }]
  mockSkillsState.hash = 'hash-1'
  mockSkillsState.isLoading = false
  mockSkillsState.loadError = null
  mockSkillsState.skills = []
})

afterEach(() => {
  cleanup()
})

describe('SkillsPageClient', () => {
  it('renders admin empty state and opens the import dialog', () => {
    render(<SkillsPageClient isAdmin slug="alice" />)

    expect(screen.getByText('No skills configured yet')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: 'Import skill' })[0])
    expect(screen.getByTestId('import-dialog').textContent).toContain('open hash-1 Primary Agent')
  })

  it('renders loading, error, and populated states', () => {
    mockSkillsState.isLoading = true
    const { rerender } = render(<SkillsPageClient isAdmin={false} slug="alice" />)
    expect(screen.getByText('Loading skills...')).toBeDefined()

    mockSkillsState.isLoading = false
    mockSkillsState.loadError = 'load_failed'
    rerender(<SkillsPageClient isAdmin={false} slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('Failed to load: load_failed')).toBeDefined()
    expect(reloadMock).toHaveBeenCalledTimes(1)

    mockSkillsState.loadError = null
    mockSkillsState.skills = [{ assignedAgentIds: [], description: 'Audit SEO', hasResources: false, name: 'seo', resourcePaths: [] }]
    rerender(<SkillsPageClient isAdmin={false} slug="alice" />)
    expect(screen.getByTestId('skills-list').textContent).toBe('seo')
  })
})
