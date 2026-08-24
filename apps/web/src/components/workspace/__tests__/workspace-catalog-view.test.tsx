/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceCatalogView } from '@/components/workspace/workspace-catalog-view'

const searchParamsMock = vi.hoisted(() => ({ current: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock.current,
  usePathname: () => '/w/alice',
}))

vi.mock('@/components/agents/agents-page', () => ({
  AgentsPageClient: ({ isAdmin, slug }: { isAdmin: boolean; slug: string }) => (
    <div data-testid="agents-page" data-admin={String(isAdmin)} data-slug={slug}>Agents</div>
  ),
}))

vi.mock('@/components/agents/web-agent-form', () => ({
  WebAgentForm: ({ mode, agentId, slug }: { mode: string; agentId?: string; slug: string }) => (
    <div data-testid="web-agent-form" data-mode={mode} data-agent-id={agentId ?? ''} data-slug={slug}>Agent form</div>
  ),
}))

vi.mock('@/components/skills/skills-page', () => ({
  SkillsPageClient: ({ isAdmin, slug }: { isAdmin: boolean; slug: string }) => (
    <div data-testid="skills-page" data-admin={String(isAdmin)} data-slug={slug}>Skills</div>
  ),
}))

vi.mock('@/components/skills/web-skill-form', () => ({
  WebSkillForm: ({ mode, skillName, slug }: { mode: string; skillName?: string; slug: string }) => (
    <div data-testid="web-skill-form" data-mode={mode} data-skill-name={skillName ?? ''} data-slug={slug}>Skill form</div>
  ),
}))

describe('WorkspaceCatalogView', () => {
  beforeEach(() => {
    searchParamsMock.current = new URLSearchParams()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing without a catalog param', () => {
    const { container } = render(<WorkspaceCatalogView slug="alice" isAdmin />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the agents list for catalog=agents', () => {
    searchParamsMock.current = new URLSearchParams('catalog=agents')
    render(<WorkspaceCatalogView slug="alice" isAdmin />)

    expect(screen.getByTestId('agents-page').dataset.admin).toBe('true')
    expect(screen.getByTestId('agents-page').dataset.slug).toBe('alice')
  })

  it('renders the agent create form for catalog=agents&agent=new', () => {
    searchParamsMock.current = new URLSearchParams('catalog=agents&agent=new')
    render(<WorkspaceCatalogView slug="alice" isAdmin />)

    const form = screen.getByTestId('web-agent-form')
    expect(form.dataset.mode).toBe('create')
    expect(form.dataset.slug).toBe('alice')
    expect(screen.getByRole('heading', { name: 'Create agent' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /back to agents/i })).toBeNull()
  })

  it('renders the agent edit form for catalog=agents&agent=helper', () => {
    searchParamsMock.current = new URLSearchParams('catalog=agents&agent=helper')
    render(<WorkspaceCatalogView slug="alice" isAdmin />)

    const form = screen.getByTestId('web-agent-form')
    expect(form.dataset.mode).toBe('edit')
    expect(form.dataset.agentId).toBe('helper')
    expect(screen.getByRole('heading', { name: 'Edit agent' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /back to agents/i })).toBeNull()
  })

  it('renders the skills list for catalog=skills', () => {
    searchParamsMock.current = new URLSearchParams('catalog=skills')
    render(<WorkspaceCatalogView slug="alice" isAdmin />)

    expect(screen.getByTestId('skills-page').dataset.admin).toBe('true')
  })

  it('renders the skill create form for catalog=skills&skill=new', () => {
    searchParamsMock.current = new URLSearchParams('catalog=skills&skill=new')
    render(<WorkspaceCatalogView slug="alice" isAdmin />)

    const form = screen.getByTestId('web-skill-form')
    expect(form.dataset.mode).toBe('create')
    expect(form.dataset.slug).toBe('alice')
    expect(screen.getByRole('heading', { name: 'Create skill' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /back to skills/i })).toBeNull()
  })

  it('renders the skill edit form for catalog=skills&skill=writer', () => {
    searchParamsMock.current = new URLSearchParams('catalog=skills&skill=writer')
    render(<WorkspaceCatalogView slug="alice" isAdmin />)

    const form = screen.getByTestId('web-skill-form')
    expect(form.dataset.mode).toBe('edit')
    expect(form.dataset.skillName).toBe('writer')
    expect(screen.getByRole('heading', { name: 'Edit skill' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /back to skills/i })).toBeNull()
  })

  it('passes a non-admin flag through to list views', () => {
    searchParamsMock.current = new URLSearchParams('catalog=agents')
    render(<WorkspaceCatalogView slug="alice" isAdmin={false} />)

    expect(screen.getByTestId('agents-page').dataset.admin).toBe('false')
  })
})
