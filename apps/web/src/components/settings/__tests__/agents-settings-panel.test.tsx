/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentsSettingsPanel } from '@/components/settings/agents-settings-panel'

const reloadMock = vi.fn()
const useAgentsCatalogMock = vi.fn()

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

describe('AgentsSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reloadMock.mockResolvedValue(undefined)
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
})
