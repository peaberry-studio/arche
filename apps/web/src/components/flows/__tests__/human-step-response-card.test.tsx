/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HumanStepResponseCard } from '@/components/flows/human-step-response-card'
import type { FlowRunListItem } from '@/lib/flows/types'

const clientMocks = vi.hoisted(() => ({
  submitHumanResponseRequest: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  submitHumanResponseRequest: clientMocks.submitHumanResponseRequest,
}))

const run: FlowRunListItem = {
  currentNodeId: 'human-1',
  error: null,
  finishedAt: null,
  flowId: 'flow-1',
  id: 'run-1',
  openCodeSessionId: 'session-1',
  scheduledFor: '2026-05-12T10:00:00.000Z',
  sessionTitle: 'Flow | Test',
  startedAt: '2026-05-12T10:00:00.000Z',
  status: 'waiting_for_human',
  steps: [{
    compactedOutput: null,
    createdAt: '2026-05-12T10:00:00.000Z',
    error: null,
    finishedAt: null,
    humanResponse: null,
    id: 'step-1',
    input: { instructions: 'Approve or reject.' },
    nodeId: 'human-1',
    nodeName: 'Approval',
    nodeType: 'human',
    rawOutput: null,
    startedAt: '2026-05-12T10:00:00.000Z',
    status: 'waiting_for_human',
    updatedAt: '2026-05-12T10:00:00.000Z',
  }],
  trigger: 'manual',
}

describe('HumanStepResponseCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.submitHumanResponseRequest.mockResolvedValue({ ok: true, data: { ok: true } })
  })

  afterEach(() => cleanup())

  it('renders waiting instructions and submits a response', async () => {
    const onSubmitted = vi.fn()
    render(<HumanStepResponseCard run={run} slug="alice" onSubmitted={onSubmitted} />)

    expect(screen.getByText('Waiting for human input')).toBeTruthy()
    expect(screen.getByText('Approve or reject.')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Enter the human response for this step.'), { target: { value: 'Approved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit and resume' }))

    await waitFor(() => expect(clientMocks.submitHumanResponseRequest).toHaveBeenCalledWith('alice', 'run-1', 'Approved'))
    expect(onSubmitted).toHaveBeenCalled()
  })

  it('does not render for completed runs', () => {
    const { container } = render(<HumanStepResponseCard run={{ ...run, status: 'succeeded' }} slug="alice" />)

    expect(container.textContent).toBe('')
  })
})
