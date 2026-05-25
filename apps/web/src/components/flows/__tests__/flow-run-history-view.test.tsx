/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowRunHistoryView } from '@/components/flows/flow-run-history-view'
import type { FlowDetail } from '@/lib/flows/types'

const mocks = vi.hoisted(() => ({
  copyFlowRequest: vi.fn(),
  fetchFlowDetail: vi.fn(),
  runFlowRequest: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  copyFlowRequest: mocks.copyFlowRequest,
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
    mocks.copyFlowRequest.mockResolvedValue({ ok: true, data: { flow } })
    mocks.runFlowRequest.mockResolvedValue({ ok: true, data: { ok: true } })
  })

  afterEach(() => cleanup())

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

  it('copies a flow and redirects to the copied flow', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
    mocks.copyFlowRequest.mockResolvedValueOnce({ ok: true, data: { flow: { ...flow, id: 'copy-1' } } })

    try {
      render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)
      await screen.findByTestId('flow-history')

      fireEvent.click(screen.getByRole('button', { name: 'Copy flow' }))

      await waitFor(() => expect(mocks.copyFlowRequest).toHaveBeenCalledWith('alice', 'flow-1'))
      expect(window.location.href).toBe('/u/alice/flows/copy-1')
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('shows copy errors and blocks runs with missing connectors', async () => {
    mocks.fetchFlowDetail.mockResolvedValueOnce({
      ok: true,
      data: { flow: { ...flow, missingConnectorRequirements: [{ agentId: 'agent-1', agentName: 'Agent', capabilityId: 'slack', connectorName: null, connectorType: 'slack' }] } },
    })
    mocks.copyFlowRequest.mockResolvedValueOnce({ ok: false, error: 'copy_failed' })

    render(<FlowRunHistoryView flowId="flow-1" slug="alice" />)
    await screen.findByTestId('flow-history')

    expect(screen.getByText('Missing connectors: slack.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /run flow/i })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Copy flow' }))

    expect(await screen.findByText('copy_failed')).toBeTruthy()
  })

  it('hides copy and switches edit link text for view-only flows', async () => {
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
    expect(screen.queryByRole('button', { name: 'Copy flow' })).toBeNull()
    expect(screen.getByRole('button', { name: /run flow/i })).toHaveProperty('disabled', true)
  })
})
