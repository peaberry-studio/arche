/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowsPage } from '@/components/flows/flows-page'
import type { FlowListItem } from '@/lib/flows/types'

const clientMocks = vi.hoisted(() => ({
  fetchFlowList: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  fetchFlowList: clientMocks.fetchFlowList,
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

  it('links each card to history and edit', async () => {
    render(<FlowsPage slug="alice" />)
    await waitFor(() => expect(screen.getByText('Weekly Review')).toBeTruthy())

    const historyLink = screen.getByRole('link', { name: 'View run history for Weekly Review' })
    expect(historyLink.getAttribute('href')).toBe('/u/alice/flows/flow-1/runs')

    const editLink = screen.getByRole('link', { name: 'Edit Weekly Review' })
    expect(editLink.getAttribute('href')).toBe('/u/alice/flows/flow-1')
  })

  it('shows load errors', async () => {
    clientMocks.fetchFlowList.mockResolvedValue({ ok: false, error: 'load_failed' })

    render(<FlowsPage slug="alice" />)

    await waitFor(() => expect(screen.getByText('Could not load flows')).toBeTruthy())
    expect(screen.getByText('load_failed')).toBeTruthy()
  })
})
