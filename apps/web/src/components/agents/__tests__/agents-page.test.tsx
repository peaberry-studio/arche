/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentsPageClient } from '@/components/agents/agents-page'

const useAgentsCatalogMock = vi.fn()
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

vi.mock('@phosphor-icons/react', () => ({
  Robot: () => <svg data-testid="robot-icon" />,
  SpinnerGap: ({ className }: { className?: string }) => <svg data-testid="spinner-icon" className={className} />,
}))

vi.mock('@/components/agents/agent-card', () => ({
  AgentCard: ({ displayName, resolvedModel, usesDefaultModel }: {
    displayName: string
    resolvedModel?: string
    usesDefaultModel?: boolean
  }) => (
    <div data-testid="agent-card">
      {displayName}
      {resolvedModel ? ` ${resolvedModel} ${usesDefaultModel ? 'default' : 'override'}` : ''}
    </div>
  ),
}))

vi.mock('@/components/dashboard/dashboard-empty-state', () => ({
  DashboardEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: (slug: string) => useAgentsCatalogMock(slug),
}))

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: vi.fn(),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('AgentsPageClient', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ id: 'openai/gpt-5.5', label: 'GPT 5.5' }] }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows loading state', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: true, loadError: null, reload: vi.fn() })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    expect(screen.getByText('Loading agents...')).toBeTruthy()
    expect(screen.getByTestId('spinner-icon')).toBeTruthy()
  })

  it('shows custom loading label', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: true, loadError: null, reload: vi.fn() })

    render(<AgentsPageClient slug="alice" isAdmin={true} loadingLabel="Fetching..." />)

    expect(screen.getByText('Fetching...')).toBeTruthy()
  })

  it('shows error state', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: false, loadError: 'network_error', reload: vi.fn() })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    expect(screen.getByText('Failed to load: network_error')).toBeTruthy()
  })

  it('shows empty state for admin with primary action', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: false, loadError: null, reload: vi.fn() })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    expect(screen.getByTestId('empty-state').textContent).toBe('No agents configured yet')
  })

  it('shows empty state for non-admin without primary action', () => {
    useAgentsCatalogMock.mockReturnValue({ agents: [], isLoading: false, loadError: null, reload: vi.fn() })

    render(<AgentsPageClient slug="alice" isAdmin={false} />)

    expect(screen.getByTestId('empty-state').textContent).toBe('No agents configured yet')
  })

  it('renders agent cards', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [
        { id: 'agent-1', displayName: 'Agent One', description: 'First agent', resolvedModel: 'gpt-4', usesDefaultModel: true, isPrimary: true },
        { id: 'agent-2', displayName: 'Agent Two', description: 'Second agent', resolvedModel: 'claude', usesDefaultModel: false, isPrimary: false },
      ],
      defaultModel: 'gpt-4',
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload: vi.fn(),
    })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    const cards = screen.getAllByTestId('agent-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Agent One')
    expect(cards[1].textContent).toContain('Agent Two')
    expect(screen.getByText(/gpt-4 default/)).toBeTruthy()
    expect(screen.getByText(/claude override/)).toBeTruthy()
  })

  it('renders and saves workspace default model for admins', async () => {
    const reload = vi.fn()
    useAgentsCatalogMock.mockReturnValue({
      agents: [],
      defaultModel: 'openai/gpt-5.5',
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload,
    })
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [{ id: 'openai/gpt-5.5', label: 'GPT 5.5' }] })
      if (url.endsWith('/agents/default-model') && init?.method === 'PATCH') {
        return jsonResponse({ defaultModel: 'openai/gpt-6', hash: 'hash-2' })
      }
      return jsonResponse({})
    })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    await waitFor(() => expect(screen.getByText('GPT 5.5')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'openai/gpt-6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save default model' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    const patchCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === '/api/u/alice/agents/default-model' && init?.method === 'PATCH'
    )
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      defaultModel: 'openai/gpt-6',
      expectedHash: 'hash-1',
    })
    expect(screen.getByText('Default model saved.')).toBeTruthy()
  })

  it('shows default model errors for admins', async () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [],
      defaultModel: 'openai/gpt-5.5',
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload: vi.fn(),
    })
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/default-model') && init?.method === 'PATCH') {
        return jsonResponse({ error: 'hash_conflict' }, { status: 409 })
      }
      return jsonResponse({})
    })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save default model' }))

    await waitFor(() => expect(screen.getByText('Error: hash_conflict')).toBeTruthy())
  })

  it('shows a network error when saving the default model fails', async () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [],
      defaultModel: 'openai/gpt-5.5',
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload: vi.fn(),
    })
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/default-model') && init?.method === 'PATCH') throw new Error('offline')
      return jsonResponse({})
    })

    render(<AgentsPageClient slug="alice" isAdmin={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save default model' }))

    await waitFor(() => expect(screen.getByText('Error: network_error')).toBeTruthy())
  })

  it('renders default model as read-only for non-admins', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [],
      defaultModel: null,
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload: vi.fn(),
    })

    render(<AgentsPageClient slug="alice" isAdmin={false} />)

    expect(screen.getByText('No default model configured.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save default model' })).toBeNull()
  })

  it('filters out primary agents when includePrimary is false', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [
        { id: 'agent-1', displayName: 'Agent One', isPrimary: true },
        { id: 'agent-2', displayName: 'Agent Two', isPrimary: false },
      ],
      isLoading: false,
      loadError: null,
      reload: vi.fn(),
    })

    render(<AgentsPageClient slug="alice" isAdmin={true} includePrimary={false} />)

    expect(screen.getAllByTestId('agent-card')).toHaveLength(1)
    expect(screen.getByText('Agent Two')).toBeTruthy()
    expect(screen.queryByText('Agent One')).toBeNull()
  })
})
