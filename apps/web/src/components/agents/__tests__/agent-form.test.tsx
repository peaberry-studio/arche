/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentForm } from '@/components/agents/agent-form'
import type { AgentConnectorCapabilityOption } from '@/lib/agent-connector-capabilities'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const mockNotifyWorkspaceConfigChanged = vi.fn()

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: () => mockNotifyWorkspaceConfigChanged(),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function requestBodyFor(method: string, path: string) {
  const call = fetchMock.mock.calls.find(([input, init]) =>
    String(input) === path && init?.method === method
  )
  if (!call?.[1]?.body || typeof call[1].body !== 'string') throw new Error('missing request body')
  return JSON.parse(call[1].body) as Record<string, unknown>
}

function submitForm(buttonName: string) {
  const button = screen.getByRole('button', { name: buttonName })
  const form = button.closest('form')
  if (!form) throw new Error('missing form')
  fireEvent.submit(form)
}

const connectors: AgentConnectorCapabilityOption[] = [
  {
    id: 'globalzendesk',
    type: 'zendesk',
    name: 'Zendesk',
    enabled: true,
    scope: 'type',
    ownerKind: null,
    ownerSlug: null,
  },
  {
    id: 'custom-crm',
    type: 'custom',
    name: 'Custom CRM',
    enabled: false,
    scope: 'connector',
    ownerKind: 'USER',
    ownerSlug: 'alice',
  },
]

function mockSharedEndpoints() {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/agents/models')) {
      return jsonResponse({ models: [{ id: 'openai/gpt-4.1', label: 'GPT 4.1' }] })
    }
    if (url.endsWith('/agents/connectors')) {
      return jsonResponse({ connectors })
    }
    if (url.endsWith('/skills')) {
      return jsonResponse({ skills: [{ name: 'seo-audit', description: 'Audit SEO' }] })
    }
    if (url.endsWith('/agents') && !init?.method) {
      return jsonResponse({ hash: 'hash-agents' })
    }
    if (url.endsWith('/agents') && init?.method === 'POST') {
      return jsonResponse({ agent: { id: 'research-agent' }, hash: 'hash-created' })
    }
    return jsonResponse({})
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  mockNotifyWorkspaceConfigChanged.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentForm', () => {
  it('creates an agent with model, tools, connectors, skills, and primary status', async () => {
    const onSaved = vi.fn()
    mockSharedEndpoints()

    render(<AgentForm slug="alice" mode="create" onSaved={onSaved} />)

    expect(await screen.findByText('Zendesk')).toBeDefined()
    expect(screen.getByText('seo-audit')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Research Agent' } })
    fireEvent.click(screen.getByLabelText('Use workspace default model'))
    fireEvent.change(screen.getByLabelText('Model override'), { target: { value: 'openai/gpt-4.1' } })
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '0.4' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Research specialist' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Investigate carefully.' } })
    fireEvent.click(screen.getByLabelText('Write files'))
    fireEvent.click(screen.getByLabelText(/Zendesk/))
    fireEvent.click(screen.getByLabelText('seo-audit'))
    fireEvent.click(screen.getByLabelText('Set as primary'))
    submitForm('Create agent')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ agentId: 'research-agent', mode: 'create' }))
    expect(requestBodyFor('POST', '/api/u/alice/agents')).toEqual({
      displayName: 'Research Agent',
      description: 'Research specialist',
      model: 'openai/gpt-4.1',
      temperature: 0.4,
      prompt: 'Investigate carefully.',
      isPrimary: true,
      expectedHash: 'hash-agents',
      capabilities: {
        tools: ['write'],
        mcpConnectorIds: ['globalzendesk'],
        skillIds: ['seo-audit'],
      },
    })
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('validates create form display name before saving', async () => {
    mockSharedEndpoints()

    render(<AgentForm slug="alice" mode="create" />)

    expect(await screen.findByText('Zendesk')).toBeDefined()
    submitForm('Create agent')

    expect(screen.getByText('Error: Display name is required.')).toBeDefined()
    expect(fetchMock.mock.calls.some(([_input, init]) => init?.method === 'POST')).toBe(false)
  })

  it('creates an agent using the workspace default model', async () => {
    const onSaved = vi.fn()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors: [] })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      if (url.endsWith('/agents') && !init?.method) {
        return jsonResponse({ defaultModel: 'openai/gpt-5.5', hash: 'hash-agents' })
      }
      if (url.endsWith('/agents') && init?.method === 'POST') {
        return jsonResponse({ agent: { id: 'default-agent' }, hash: 'hash-created' })
      }
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="create" onSaved={onSaved} />)

    expect(await screen.findByText('Using openai/gpt-5.5')).toBeDefined()
    expect((screen.getByLabelText('Use workspace default model') as HTMLInputElement).checked).toBe(true)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Default Agent' } })
    submitForm('Create agent')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ agentId: 'default-agent', mode: 'create' }))
    expect(requestBodyFor('POST', '/api/u/alice/agents').model).toBeNull()
  })

  it('loads and updates an existing secondary agent', async () => {
    const onSaved = vi.fn()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [{ name: 'seo-audit', description: '' }] })
      if (url.endsWith('/agents/agent-1') && init?.method === 'PATCH') return jsonResponse({ hash: 'hash-updated' })
      if (url.endsWith('/agents/agent-1')) {
        return jsonResponse({
          hash: 'hash-existing',
          agent: {
            id: 'agent-1',
            displayName: 'Support Agent',
            description: 'Helps customers',
            model: 'anthropic/claude-sonnet-4',
            temperature: 0.2,
            prompt: 'Be helpful.',
            isPrimary: false,
            capabilities: {
              tools: ['read'],
              mcpConnectorIds: ['custom-crm'],
              skillIds: ['seo-audit'],
            },
          },
        })
      }
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="edit" agentId="agent-1" onSaved={onSaved} />)

    expect(await screen.findByDisplayValue('Support Agent')).toBeDefined()
    expect(screen.getByDisplayValue('agent-1')).toBeDefined()
    expect(screen.getByDisplayValue('anthropic/claude-sonnet-4')).toBeDefined()
    expect(screen.getByText('Current: anthropic/claude-sonnet-4')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Escalates customer issues' } })
    fireEvent.click(screen.getByLabelText('Read files'))
    fireEvent.click(screen.getByLabelText('Write files'))
    fireEvent.click(screen.getByLabelText(/Custom CRM/))
    fireEvent.click(screen.getByLabelText(/Zendesk/))
    fireEvent.click(screen.getByLabelText('seo-audit'))
    submitForm('Save changes')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ agentId: 'agent-1', mode: 'edit' }))
    expect(requestBodyFor('PATCH', '/api/u/alice/agents/agent-1')).toEqual({
      displayName: 'Support Agent',
      description: 'Escalates customer issues',
      model: 'anthropic/claude-sonnet-4',
      temperature: 0.2,
      prompt: 'Be helpful.',
      expectedHash: 'hash-existing',
      capabilities: {
        tools: ['write'],
        mcpConnectorIds: ['globalzendesk'],
        skillIds: [],
      },
    })
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('promotes an existing agent to primary', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors: [] })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      if (url.endsWith('/agents/agent-1') && init?.method === 'PATCH') return jsonResponse({ hash: 'hash-primary' })
      if (url.endsWith('/agents/agent-1')) {
        return jsonResponse({
          hash: 'hash-existing',
          agent: { id: 'agent-1', displayName: 'Support Agent', isPrimary: false },
        })
      }
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="edit" agentId="agent-1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Primary' }))

    await waitFor(() => expect(requestBodyFor('PATCH', '/api/u/alice/agents/agent-1')).toEqual({
      isPrimary: true,
      expectedHash: 'hash-existing',
    }))
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('updates an existing agent to use the workspace default model', async () => {
    const onSaved = vi.fn()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors: [] })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      if (url.endsWith('/agents/agent-1') && init?.method === 'PATCH') return jsonResponse({ hash: 'hash-updated' })
      if (url.endsWith('/agents/agent-1')) {
        return jsonResponse({
          hash: 'hash-existing',
          agent: {
            id: 'agent-1',
            displayName: 'Support Agent',
            defaultModel: 'openai/gpt-5.5',
            model: 'anthropic/claude-sonnet-4',
            resolvedModel: 'anthropic/claude-sonnet-4',
            usesDefaultModel: false,
            isPrimary: false,
          },
        })
      }
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="edit" agentId="agent-1" onSaved={onSaved} />)

    expect(await screen.findByDisplayValue('anthropic/claude-sonnet-4')).toBeDefined()
    fireEvent.click(screen.getByLabelText('Use workspace default model'))
    expect(screen.getByText('Using openai/gpt-5.5')).toBeDefined()
    submitForm('Save changes')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ agentId: 'agent-1', mode: 'edit' }))
    expect(requestBodyFor('PATCH', '/api/u/alice/agents/agent-1').model).toBeNull()
  })

  it('warns when default model is enabled without workspace default', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors: [] })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      if (url.endsWith('/agents/agent-1')) {
        return jsonResponse({
          hash: 'hash-existing',
          agent: { id: 'agent-1', displayName: 'Support Agent', usesDefaultModel: true, isPrimary: false },
        })
      }
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="edit" agentId="agent-1" />)

    expect(await screen.findByText('No workspace default model is configured.')).toBeDefined()
  })

  it('deletes an existing secondary agent after confirmation', async () => {
    const onDeleted = vi.fn()
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors: [] })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      if (url.endsWith('/agents/agent-1') && init?.method === 'DELETE') return jsonResponse({})
      if (url.endsWith('/agents/agent-1')) {
        return jsonResponse({
          hash: 'hash-existing',
          agent: { id: 'agent-1', displayName: 'Support Agent', isPrimary: false },
        })
      }
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="edit" agentId="agent-1" onDeleted={onDeleted} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete agent' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith({ agentId: 'agent-1' }))
    expect(confirmMock).toHaveBeenCalledWith('Delete the agent "Support Agent"?')
    expect(requestBodyFor('DELETE', '/api/u/alice/agents/agent-1')).toEqual({ expectedHash: 'hash-existing' })
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('renders load and options fallback states', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors: [] })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      if (url.endsWith('/agents/missing')) return jsonResponse({ error: 'missing_agent' }, { status: 404 })
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="edit" agentId="missing" />)
    expect(await screen.findByText('Failed to load: missing_agent')).toBeDefined()

    cleanup()
    mockSharedEndpoints()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/agents/models')) return jsonResponse({ models: [] })
      if (url.endsWith('/agents/connectors')) return jsonResponse({ connectors: [] })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      if (url.endsWith('/agents') && !init?.method) return jsonResponse({ hash: 'hash-agents' })
      return jsonResponse({})
    })

    render(<AgentForm slug="alice" mode="create" allowPrimarySelection={false} />)
    expect(await screen.findByText('No connectors available.')).toBeDefined()
    expect(screen.getByText('No skills available.')).toBeDefined()
    expect(screen.queryByLabelText('Set as primary')).toBeNull()
  })
})
