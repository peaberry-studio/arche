/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowsPage } from '@/components/flows/flows-page'
import type { FlowListItem } from '@/lib/flows/types'

const clientMocks = vi.hoisted(() => ({
  fetchFlowList: vi.fn(),
  runFlowRequest: vi.fn(),
  updateFlowRequest: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  fetchFlowList: clientMocks.fetchFlowList,
  runFlowRequest: clientMocks.runFlowRequest,
  updateFlowRequest: clientMocks.updateFlowRequest,
}))

const flow: FlowListItem = {
  createdAt: '2026-05-12T10:00:00.000Z',
  cronExpression: '0 9 * * 1',
  definition: { edges: [], nodes: [{ compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Prompt', targetAgentId: null, type: 'agent' }], startNodeId: 'agent-1', version: 1 },
  description: 'Automates work',
  enabled: true,
  id: 'flow-1',
  lastRunAt: null,
  latestRun: null,
  name: 'Weekly Review',
  nextRunAt: '2026-05-18T09:00:00.000Z',
  timezone: 'UTC',
  updatedAt: '2026-05-12T10:00:00.000Z',
}

describe('FlowsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.fetchFlowList.mockResolvedValue({ ok: true, data: { flows: [flow] } })
    clientMocks.runFlowRequest.mockResolvedValue({ ok: true, data: { ok: true } })
    clientMocks.updateFlowRequest.mockResolvedValue({ ok: true, data: { flow: { ...flow, enabled: false, runs: [] } } })
  })

  afterEach(() => {
    cleanup()
  })

  it('loads and renders flows', async () => {
    render(<FlowsPage slug="alice" />)

    expect(screen.getByText('Loading flows...')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Weekly Review')).toBeTruthy())
    expect(screen.getByText('Automates work')).toBeTruthy()
  })

  it('shows an empty state', async () => {
    clientMocks.fetchFlowList.mockResolvedValue({ ok: true, data: { flows: [] } })

    render(<FlowsPage slug="alice" />)

    await waitFor(() => expect(screen.getByText('No flows yet')).toBeTruthy())
  })

  it('runs and toggles flows through client helpers', async () => {
    render(<FlowsPage slug="alice" />)
    await waitFor(() => expect(screen.getByText('Weekly Review')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Run now/ }))
    await waitFor(() => expect(clientMocks.runFlowRequest).toHaveBeenCalledWith('alice', 'flow-1'))

    fireEvent.click(screen.getByRole('button', { name: /Pause/ }))
    await waitFor(() => expect(clientMocks.updateFlowRequest).toHaveBeenCalledWith('alice', 'flow-1', { enabled: false }))
  })

  it('shows load errors', async () => {
    clientMocks.fetchFlowList.mockResolvedValue({ ok: false, error: 'load_failed' })

    render(<FlowsPage slug="alice" />)

    await waitFor(() => expect(screen.getByText('Could not load flows')).toBeTruthy())
    expect(screen.getByText('load_failed')).toBeTruthy()
  })
})
