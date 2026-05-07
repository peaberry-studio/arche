/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentsSettingsPanel } from '@/components/settings/agents-settings-panel'

const reloadMock = vi.fn()
const useAgentsCatalogMock = vi.fn()
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: (...args: unknown[]) => useAgentsCatalogMock(...args),
}))

const agentFormMock = vi.fn()
vi.mock('@/components/agents/agent-form', () => ({
  AgentForm: (props: {
    agentId?: string
    mode: 'create' | 'edit'
    onCancel?: () => void
    onSaved?: () => Promise<void>
  }) => {
    agentFormMock(props)
    return (
      <div>
        <p>Agent Form {props.mode}</p>
        <p>{props.agentId ?? 'new-agent'}</p>
        <button type="button" onClick={() => props.onSaved?.()}>
          Save form
        </button>
        <button type="button" onClick={() => props.onCancel?.()}>
          Cancel form
        </button>
      </div>
    )
  },
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

describe('AgentsSettingsPanel', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    reloadMock.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ id: 'openai/gpt-5.5', label: 'GPT 5.5' }] }))
    vi.stubGlobal('fetch', fetchMock)
    useAgentsCatalogMock.mockReturnValue({
      agents: [
        {
          id: 'assistant',
          displayName: 'Assistant',
          description: 'Primary agent',
          model: 'gpt-5',
          isPrimary: true,
        },
        {
          id: 'researcher',
          displayName: 'Researcher',
          description: 'Secondary agent',
          model: 'gpt-4.1',
          isPrimary: false,
        },
      ],
      defaultModel: 'openai/gpt-5.5',
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload: reloadMock,
    })
  })

  it('renders primary and expert sections and opens the embedded editor', async () => {
    render(<AgentsSettingsPanel slug="local" />)

    expect(screen.getByRole('heading', { name: 'Primary agent' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Experts' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit primary agent' }))
    expect(screen.getByText('Agent Form edit')).toBeTruthy()
    expect(screen.getByText('assistant')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save form' }))

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('heading', { name: 'Primary agent' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create expert' }))
    expect(screen.getByText('Agent Form create')).toBeTruthy()
    expect(screen.getByText('new-agent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel form' }))
    expect(screen.getByRole('heading', { name: 'Experts' })).toBeTruthy()
  })

  it('shows loading state', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [],
      defaultModel: null,
      hash: 'hash-1',
      isLoading: true,
      loadError: null,
      reload: reloadMock,
    })

    render(<AgentsSettingsPanel slug="local" />)

    expect(screen.getByText('Loading agents...')).toBeTruthy()
  })

  it('shows empty primary and experts states', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [],
      defaultModel: null,
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload: reloadMock,
    })

    render(<AgentsSettingsPanel slug="local" />)

    expect(screen.getByText('No primary agent is configured.')).toBeTruthy()
    expect(screen.getByText('No experts configured yet.')).toBeTruthy()
  })

  it('renders and saves the workspace default model', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/default-model') && init?.method === 'PATCH') {
        return jsonResponse({ defaultModel: 'openai/gpt-6', hash: 'hash-2' })
      }
      return jsonResponse({})
    })

    render(<AgentsSettingsPanel slug="local" />)

    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'openai/gpt-6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save default model' }))

    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
    const patchCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === '/api/u/local/agents/default-model' && init?.method === 'PATCH'
    )
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      defaultModel: 'openai/gpt-6',
      expectedHash: 'hash-1',
    })
    expect(screen.getByText('Default model saved.')).toBeTruthy()
  })

  it('shows default model save errors', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/default-model') && init?.method === 'PATCH') {
        return jsonResponse({ error: 'hash_conflict' }, { status: 409 })
      }
      return jsonResponse({})
    })

    render(<AgentsSettingsPanel slug="local" />)

    fireEvent.click(screen.getByRole('button', { name: 'Save default model' }))

    await waitFor(() => expect(screen.getByText('Error: hash_conflict')).toBeTruthy())
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('shows a network error when saving the default model fails', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/default-model') && init?.method === 'PATCH') throw new Error('offline')
      return jsonResponse({})
    })

    render(<AgentsSettingsPanel slug="local" />)

    fireEvent.click(screen.getByRole('button', { name: 'Save default model' }))

    await waitFor(() => expect(screen.getByText('Error: network_error')).toBeTruthy())
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('shows a retry action when agents fail to load', () => {
    useAgentsCatalogMock.mockReturnValue({
      agents: [],
      defaultModel: null,
      hash: 'hash-1',
      isLoading: false,
      loadError: 'network_error',
      reload: reloadMock,
    })

    render(<AgentsSettingsPanel slug="local" />)

    expect(screen.getByText('Failed to load: network_error')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reloadMock).toHaveBeenCalledTimes(1)
  })
})
