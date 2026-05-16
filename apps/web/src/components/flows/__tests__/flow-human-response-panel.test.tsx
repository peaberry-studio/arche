/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowHumanResponsePanel } from '@/components/flows/flow-human-response-panel'
import type { FlowRunListItem } from '@/lib/flows/types'

const clientMocks = vi.hoisted(() => ({
  fetchFlowRunRequest: vi.fn(),
  submitHumanResponseRequest: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  fetchFlowRunRequest: clientMocks.fetchFlowRunRequest,
  submitHumanResponseRequest: clientMocks.submitHumanResponseRequest,
}))

const waitingRun: FlowRunListItem = {
  currentNodeId: 'human-1',
  error: null,
  finishedAt: null,
  flowId: 'flow-1',
  id: 'run-1',
  attempt: 1,
  lastRetryError: null,
  openCodeSessionId: 'session-1',
  retryScheduledFor: null,
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
    input: { instructions: 'Approve deployment.' },
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

describe('FlowHumanResponsePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.fetchFlowRunRequest.mockResolvedValue({ ok: true, data: { run: waitingRun } })
    clientMocks.submitHumanResponseRequest.mockResolvedValue({ ok: true, data: { ok: true } })
  })

  afterEach(() => cleanup())

  it('loads the waiting run and submits the human response', async () => {
    const onSubmitted = vi.fn()
    render(<FlowHumanResponsePanel runId="run-1" slug="alice" onSubmitted={onSubmitted} />)

    expect(screen.getByText('Loading human input...')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Approve deployment.')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('Enter the human response for this step.'), {
      target: { value: 'Approved' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit and resume' }))

    await waitFor(() => expect(clientMocks.submitHumanResponseRequest).toHaveBeenCalledWith('alice', 'run-1', 'Approved'))
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(clientMocks.fetchFlowRunRequest).toHaveBeenCalledWith('alice', 'run-1')
    expect(clientMocks.fetchFlowRunRequest).toHaveBeenCalledTimes(2)
  })

  it('shows load errors and retries', async () => {
    clientMocks.fetchFlowRunRequest
      .mockResolvedValueOnce({ ok: false, error: 'not_found' })
      .mockResolvedValue({ ok: true, data: { run: waitingRun } })

    render(<FlowHumanResponsePanel runId="run-1" slug="alice" />)

    await waitFor(() => expect(screen.getByText('Unable to load human input: not_found')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('Approve deployment.')).toBeTruthy())
    expect(clientMocks.fetchFlowRunRequest).toHaveBeenCalledTimes(2)
  })

  it('does not render the response form after the run leaves waiting state', async () => {
    clientMocks.fetchFlowRunRequest.mockResolvedValueOnce({
      ok: true,
      data: { run: { ...waitingRun, status: 'running' } },
    })

    render(<FlowHumanResponsePanel runId="run-1" slug="alice" />)

    await waitFor(() => expect(screen.getByText('This flow run no longer needs human input. It may still be finishing.')).toBeTruthy())
    expect(screen.queryByPlaceholderText('Enter the human response for this step.')).toBeNull()
  })
})
