/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentsPanel } from '@/components/workspace/agents-panel'
import { SkillsPanel } from '@/components/workspace/skills-panel'
import type { SkillListItem } from '@/hooks/use-skills-catalog'
import type { AgentCatalogItem } from '@/hooks/use-workspace'

const agents: AgentCatalogItem[] = [
  {
    id: 'assistant',
    displayName: 'Assistant',
    model: 'openai/gpt-5.5',
    isPrimary: true,
  },
  {
    id: 'planner',
    displayName: 'Planner',
    model: 'openai/gpt-5.5',
    isPrimary: false,
  },
  {
    id: 'researcher',
    displayName: 'Researcher',
    model: 'anthropic/claude-sonnet-4.5',
    isPrimary: false,
  },
]

const skills: SkillListItem[] = [
  {
    assignedAgentIds: ['planner'],
    description: 'Plans launches',
    hasResources: false,
    name: 'Planning',
    resourcePaths: [],
  },
  {
    assignedAgentIds: ['researcher'],
    description: 'Researches markets',
    hasResources: true,
    name: 'Market Research',
    resourcePaths: ['Skills/Market Research.md'],
  },
]

describe('agent and skill panels', () => {
  afterEach(() => {
    cleanup()
  })

  it('filters non-primary agents and selects a visible expert', () => {
    const onSelectAgent = vi.fn()

    render(
      <AgentsPanel
        agents={agents}
        onSelectAgent={onSelectAgent}
        query="claude"
      />
    )

    expect(screen.getByRole('button', { name: /Researcher/ })).toBeTruthy()
    expect(screen.queryByText('Assistant')).toBeNull()
    expect(screen.queryByText('Planner')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Researcher/ }))

    expect(onSelectAgent).toHaveBeenCalledWith(agents[2])
  })

  it('renders agent empty states', () => {
    const { rerender } = render(
      <AgentsPanel agents={[agents[0]]} onSelectAgent={vi.fn()} />
    )

    expect(screen.getByText('No experts available')).toBeTruthy()

    rerender(<AgentsPanel agents={agents} onSelectAgent={vi.fn()} query="missing" />)

    expect(screen.getByText('No experts found')).toBeTruthy()
  })

  it('filters and selects skills', () => {
    const onSelectSkill = vi.fn()

    render(
      <SkillsPanel
        skills={skills}
        onSelectSkill={onSelectSkill}
        query="markets"
      />
    )

    expect(screen.getByRole('button', { name: 'Market Research' })).toBeTruthy()
    expect(screen.queryByText('Planning')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Market Research' }))

    expect(onSelectSkill).toHaveBeenCalledWith(skills[1])
  })

  it('renders skill empty states', () => {
    const { rerender } = render(<SkillsPanel skills={[]} />)

    expect(screen.getByText('No skills available')).toBeTruthy()

    rerender(<SkillsPanel skills={skills} query="missing" />)

    expect(screen.getByText('No skills found')).toBeTruthy()
  })
})
