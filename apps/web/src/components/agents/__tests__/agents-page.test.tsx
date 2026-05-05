/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentsPageClient } from '@/components/agents/agents-page'

const useAgentsCatalogMock = vi.fn()

vi.mock('@phosphor-icons/react', () => ({
  Robot: () => <svg data-testid="robot-icon" />,
  SpinnerGap: ({ className }: { className?: string }) => <svg data-testid="spinner-icon" className={className} />,
}))

vi.mock('@/components/agents/agent-card', () => ({
  AgentCard: ({ displayName }: { displayName: string }) => <div data-testid="agent-card">{displayName}</div>,
}))

vi.mock('@/components/dashboard/dashboard-empty-state', () => ({
  DashboardEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: (slug: string) => useAgentsCatalogMock(slug),
}))

describe('AgentsPageClient', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: true, loadError: null })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    expect(screen.getByText('Loading agents...')).toBeTruthy()
    expect(screen.getByTestId('spinner-icon')).toBeTruthy()
  })

  it('shows custom loading label', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: true, loadError: null })

    render(<AgentsPageClient slug="alice" isAdmin={true} loadingLabel="Fetching..." />)

    expect(screen.getByText('Fetching...')).toBeTruthy()
  })

  it('shows error state', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: false, loadError: 'network_error' })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    expect(screen.getByText('Failed to load: network_error')).toBeTruthy()
  })

  it('shows empty state for admin with primary action', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: false, loadError: null })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    expect(screen.getByTestId('empty-state').textContent).toBe('No agents configured yet')
  })

  it('shows empty state for non-admin without primary action', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: false, loadError: null })

    render(<AgentsPageClient slug="alice" isAdmin={false} />)

    expect(screen.getByTestId('empty-state').textContent).toBe('No agents configured yet')
  })

  it('renders agent cards', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [
        { id: 'agent-1', displayName: 'Agent One', description: 'First agent', model: 'gpt-4', isPrimary: true },
        { id: 'agent-2', displayName: 'Agent Two', description: 'Second agent', model: 'claude', isPrimary: false },
      ],
      isLoading: false,
      loadError: null,
    })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    expect(screen.getAllByTestId('agent-card')).toHaveLength(2)
    expect(screen.getByText('Agent One')).toBeTruthy()
    expect(screen.getByText('Agent Two')).toBeTruthy()
  })

  it('filters out primary agents when includePrimary is false', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [
        { id: 'agent-1', displayName: 'Agent One', isPrimary: true },
        { id: 'agent-2', displayName: 'Agent Two', isPrimary: false },
      ],
      isLoading: false,
      loadError: null,
    })

    render(<AgentsPageClient slug="alice" isAdmin={true} includePrimary={false} />)

    expect(screen.getAllByTestId('agent-card')).toHaveLength(1)
    expect(screen.getByText('Agent Two')).toBeTruthy()
    expect(screen.queryByText('Agent One')).toBeNull()
  })
})
