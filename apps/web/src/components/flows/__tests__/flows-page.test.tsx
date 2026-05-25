/** @vitest-environment jsdom */
import { FlowRunStatus, FlowRunTrigger } from '@prisma/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowsPage } from '@/components/flows/flows-page'
import type { FlowListItem } from '@/lib/flows/types'

const clientMocks = vi.hoisted(() => ({
  copyFlowRequest: vi.fn(),
  fetchFlowList: vi.fn(),
  push: vi.fn(),
  runFlowRequest: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: clientMocks.push }) }))
vi.mock('@/lib/flows/client', () => ({
  copyFlowRequest: clientMocks.copyFlowRequest,
  fetchFlowList: clientMocks.fetchFlowList,
  runFlowRequest: clientMocks.runFlowRequest,
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
  organizationCanRun: false,
  owner: { slug: 'alice' },
  permissions: { canCopy: true, canEdit: true, canManage: true, canRun: true, canView: true, isOwner: true },
  timezone: 'UTC',
  updatedAt: '2026-05-12T10:00:00.000Z',
  visibility: 'private',
}

function createRun(status: FlowRunStatus): FlowListItem['latestRun'] {
  return {
    attempt: 1,
    createdAt: '2026-05-12T10:00:00.000Z',
    currentNodeId: null,
    error: null,
    executionUser: { slug: 'alice' },
    executionUserId: 'user-1',
    finishedAt: null,
    flowId: 'flow-1',
    id: `run-${status}`,
    lastRetryError: null,
    openCodeSessionId: null,
    resultSeenAt: null,
    retryScheduledFor: null,
    scheduledFor: '2026-05-12T10:00:00.000Z',
    sessionTitle: null,
    startedAt: '2026-05-12T10:00:00.000Z',
    status,
    steps: [],
    trigger: FlowRunTrigger.manual,
    updatedAt: '2026-05-12T10:00:00.000Z',
  }
}

function createFlow(overrides: Partial<FlowListItem>): FlowListItem {
  return { ...flow, ...overrides }
}

describe('FlowsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.fetchFlowList.mockResolvedValue({ ok: true, data: { flows: [flow] } })
    clientMocks.copyFlowRequest.mockResolvedValue({ ok: true, data: { flow } })
    clientMocks.runFlowRequest.mockResolvedValue({ ok: true, data: { ok: true } })
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

  it('retries after network load errors', async () => {
    clientMocks.fetchFlowList
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, data: { flows: [flow] } })

    render(<FlowsPage slug="alice" />)

    await waitFor(() => expect(screen.getByText('Network error. Try again.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('Weekly Review')).toBeTruthy())
    expect(clientMocks.fetchFlowList).toHaveBeenCalledTimes(2)
  })

  it('labels run states for enabled and manual flows', async () => {
    clientMocks.fetchFlowList.mockResolvedValue({
      ok: true,
      data: {
        flows: [
          createFlow({ enabled: false, id: 'disabled', name: 'Disabled flow' }),
          createFlow({ id: 'running', latestRun: createRun(FlowRunStatus.running), name: 'Running flow' }),
          createFlow({ id: 'succeeded', latestRun: createRun(FlowRunStatus.succeeded), name: 'Succeeded flow' }),
          createFlow({ id: 'failed', latestRun: createRun(FlowRunStatus.failed), name: 'Failed flow' }),
          createFlow({ id: 'cancelled', latestRun: createRun(FlowRunStatus.cancelled), name: 'Cancelled flow' }),
          createFlow({ id: 'human', latestRun: createRun(FlowRunStatus.waiting_for_human), name: 'Human flow' }),
        ],
      },
    })

    render(<FlowsPage slug="alice" />)

    await waitFor(() => expect(screen.getByText('Cancelled flow')).toBeTruthy())
    expect(screen.getByText('Manual only')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Last run OK')).toBeTruthy()
    expect(screen.getAllByText('Last run failed')).toHaveLength(2)
    expect(screen.getByText('Waiting for human')).toBeTruthy()
  })

  it('runs and copies flows from the list', async () => {
    clientMocks.copyFlowRequest.mockResolvedValueOnce({ ok: true, data: { flow: { ...flow, id: 'copy-1' } } })

    render(<FlowsPage slug="alice" />)
    await waitFor(() => expect(screen.getByText('Weekly Review')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(clientMocks.runFlowRequest).toHaveBeenCalledWith('alice', 'flow-1'))
    expect(clientMocks.fetchFlowList).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(clientMocks.copyFlowRequest).toHaveBeenCalledWith('alice', 'flow-1'))
    expect(clientMocks.push).toHaveBeenCalledWith('/u/alice/flows/copy-1')
  })

  it('shows action errors from run, copy, and network failures', async () => {
    clientMocks.runFlowRequest.mockResolvedValueOnce({ ok: false, error: 'flow_busy' })
    clientMocks.copyFlowRequest.mockRejectedValueOnce(new Error('offline'))

    render(<FlowsPage slug="alice" />)
    await waitFor(() => expect(screen.getByText('Weekly Review')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('This flow already has a run in progress. Try again after it finishes.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText('Network error. Try again.')).toBeTruthy()
  })

  it('separates owned and team flows and hides unavailable actions', async () => {
    clientMocks.fetchFlowList.mockResolvedValue({
      ok: true,
      data: {
        flows: [
          createFlow({ id: 'owned', name: 'Owned flow' }),
          createFlow({
            id: 'team',
            name: 'Team flow',
            organizationCanRun: true,
            owner: { slug: 'bob' },
            permissions: { canCopy: false, canEdit: false, canManage: false, canRun: false, canView: true, isOwner: false },
            visibility: 'team',
          }),
        ],
      },
    })

    render(<FlowsPage slug="alice" />)

    await waitFor(() => expect(screen.getByText('Team flow')).toBeTruthy())
    expect(screen.getByText('My flows')).toBeTruthy()
    expect(screen.getByText('Team flows')).toBeTruthy()
    expect(screen.getByText('Shared by bob')).toBeTruthy()
    expect(screen.getByText('Runnable')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View Team flow' }).getAttribute('href')).toBe('/u/alice/flows/team')
  })
})
