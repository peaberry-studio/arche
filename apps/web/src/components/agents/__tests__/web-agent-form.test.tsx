/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebAgentForm } from '@/components/agents/web-agent-form'

const agentFormMock = vi.fn()

vi.mock('@/components/agents/agent-form', () => ({
  AgentForm: (props: {
    slug: string
    mode: 'create' | 'edit'
    agentId?: string
    onCancel?: () => void
    onDeleted?: () => void
    onSaved?: (result: { agentId: string; mode: 'create' | 'edit' }) => Promise<void>
  }) => {
    agentFormMock(props)
    return (
      <div data-testid="agent-form">
        <button type="button" onClick={() => props.onCancel?.()}>
          Cancel
        </button>
        <button type="button" onClick={() => props.onSaved?.({ agentId: 'agent-1', mode: props.mode })}>
          Save
        </button>
        <button type="button" onClick={() => props.onDeleted?.()}>
          Delete
        </button>
      </div>
    )
  },
}))

describe('WebAgentForm', () => {
  let pushMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    pushMock = vi.spyOn(window.history, 'pushState')
  })

  afterEach(() => {
    cleanup()
    pushMock.mockRestore()
  })

  it('renders AgentForm with correct props', () => {
    render(<WebAgentForm slug="alice" mode="create" />)

    expect(screen.getByTestId('agent-form')).toBeDefined()
    expect(agentFormMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'alice',
        mode: 'create',
      })
    )
  })

  it('navigates to agents list on cancel', () => {
    render(<WebAgentForm slug="alice" mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(pushMock).toHaveBeenCalledWith(null, '', '/w/alice?catalog=agents')
  })

  it('navigates to agents list on delete', () => {
    render(<WebAgentForm slug="alice" mode="edit" agentId="agent-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(pushMock).toHaveBeenCalledWith(null, '', '/w/alice?catalog=agents')
  })

  it('navigates to agents list on save when mode is create', () => {
    render(<WebAgentForm slug="alice" mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(pushMock).toHaveBeenCalledWith(null, '', '/w/alice?catalog=agents')
  })

  it('does not navigate on save when mode is edit', () => {
    render(<WebAgentForm slug="alice" mode="edit" agentId="agent-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(pushMock).not.toHaveBeenCalled()
  })
})
