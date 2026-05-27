/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowRunHistoryView } from '@/components/flows/flow-run-history-view'
import type { FlowDetail } from '@/lib/flows/types'

const mocks = vi.hoisted(() => ({
  fetchFlowDetail: vi.fn(),
  runFlowRequest: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  fetchFlowDetail: mocks.fetchFlowDetail,
  runFlowRequest: mocks.runFlowRequest,
}))

vi.mock('@/components/flows/flow-run-history', () => ({
  FlowRunHistory: ({ flow, slug }: { flow: FlowDetail; slug: string }) => (
    <div data-testid="flow-history" data-flow-id={flow.id} data-slug={slug}>{flow.name}</div>
  ),
}))

const flow: FlowDetail = {
  createdAt: '2026-05-12T10:00:00.000Z',
  cronExpression: null,
  definition: {
    edges: [],
    nodes: [{ compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Start', targetAgentId: null, type: 'agent' }],
    startNodeId: 'agent-1',
    version: 1,
  },
  description: null,
  enabled: false,
  id: 'flow-1',
  lastRunAt: null,
  latestRun: null,
  name: 'Daily brief',
  nextRunAt: null,
  organizationCanRun: false,
  owner: { slug: 'alice' },
  permissions: { canCopy: true, canEdit: true, canManage: true, canRun: true, canView: true, isOwner: true },
  runs: [],
  timezone: 'UTC',
  updatedAt: '2026-05-12T10:00:00.000Z',
  visibility: 'private',
}

describe('FlowRunHistoryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchFlowDetail.mockResolvedValue({ ok: true, data: { flow } })
    mocks.runFlowRequest.mockResolvedValue({ ok: true, data: { ok: true, runId: 'run-1' } })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('loads a flow and renders its run history', async () => {
    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)

    expect(screen.getByText('Loading runs...')).toBeTruthy()
    const history = await screen.findByTestId('flow-history')

    expect(history.dataset.flowId).toBe('flow-1')
    expect(history.dataset.slug).toBe('alice')
    expect(screen.getByRole('link', { name: /edit flow/i }).getAttribute('href')).toBe('/u/alice/flows/flow-1')
  })

  it('runs a flow and reloads history', async () => {
    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)
    await screen.findByTestId('flow-history')

    fireEvent.click(screen.getByRole('button', { name: /run flow/i }))

    await waitFor(() => expect(mocks.runFlowRequest).toHaveBeenCalledWith('alice', 'flow-1'))
    expect(mocks.fetchFlowDetail).toHaveBeenCalledTimes(2)
  })

  it('polls run history while a run is active', async () => {
    vi.useFakeTimers()
    const activeRun = {
      attempt: 1,
      currentNodeId: 'agent-1',
      error: null,
      executionUser: { slug: 'alice' },
      executionUserId: 'user-1',
      finishedAt: null,
      flowId: 'flow-1',
      id: 'run-1',
      lastRetryError: null,
      openCodeSessionId: null,
      retryScheduledFor: null,
      scheduledFor: '2026-05-12T10:00:00.000Z',
      sessionTitle: null,
      startedAt: '2026-05-12T10:00:00.000Z',
      status: 'running' as const,
      steps: [],
      trigger: 'manual' as const,
    }
    mocks.fetchFlowDetail
      .mockResolvedValueOnce({ ok: true, data: { flow: { ...flow, runs: [activeRun] } } })
      .mockResolvedValueOnce({ ok: true, data: { flow: { ...flow, runs: [{ ...activeRun, finishedAt: '2026-05-12T10:01:00.000Z', status: 'succeeded' as const }] } } })

    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('flow-history')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(mocks.fetchFlowDetail).toHaveBeenCalledTimes(2)
  })

  it('shows load errors and retries', async () => {
    mocks.fetchFlowDetail
      .mockResolvedValueOnce({ ok: false, error: 'not_found' })
      .mockResolvedValueOnce({ ok: true, data: { flow } })

    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)

    expect(await screen.findByText('Could not load runs')).toBeTruthy()
    expect(screen.getByText('not_found')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('flow-history')).toBeTruthy()
  })

  it('shows run action errors without clearing loaded history', async () => {
    mocks.runFlowRequest.mockResolvedValueOnce({ ok: false, error: 'flow_busy' })
    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)
    await screen.findByTestId('flow-history')

    fireEvent.click(screen.getByRole('button', { name: /run flow/i }))

    expect(await screen.findByText('This flow already has a run in progress. Try again after it finishes.')).toBeTruthy()
    expect(screen.getByTestId('flow-history')).toBeTruthy()
  })

  it('blocks runs with missing connectors', async () => {
    mocks.fetchFlowDetail.mockResolvedValueOnce({
      ok: true,
      data: { flow: { ...flow, missingConnectorRequirements: [{ agentId: 'agent-1', agentName: 'Agent', capabilityId: 'slack', connectorName: null, connectorType: 'slack' }] } },
    })

    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)
    await screen.findByTestId('flow-history')

    expect(screen.getByText((_, element) => element?.textContent === 'Missing connectors: slack.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /run flow/i })).toHaveProperty('disabled', true)
  })

  it('switches edit link text and disables run for view-only flows', async () => {
    mocks.fetchFlowDetail.mockResolvedValueOnce({
      ok: true,
      data: {
        flow: {
          ...flow,
          permissions: { canCopy: false, canEdit: false, canManage: false, canRun: false, canView: true, isOwner: false },
        },
      },
    })

    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)
    await screen.findByTestId('flow-history')

    expect(screen.getByRole('link', { name: /view flow/i }).getAttribute('href')).toBe('/u/alice/flows/flow-1')
    expect(screen.queryByRole('button', { name: /copy flow/i })).toBeNull()
    expect(screen.getByRole('button', { name: /run flow/i })).toHaveProperty('disabled', true)
  })
})
