/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowRunHistory } from '@/components/flows/flow-run-history'
import type { FlowDetail } from '@/lib/flows/types'

const clientMocks = vi.hoisted(() => ({
  cancelFlowRunRequest: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  cancelFlowRunRequest: clientMocks.cancelFlowRunRequest,
}))

const flow: FlowDetail = {
  createdAt: '2026-05-12T10:00:00.000Z',
  cronExpression: null,
  definition: { edges: [], nodes: [], startNodeId: '', version: 1 },
  description: null,
  enabled: false,
  id: 'flow-1',
  lastRunAt: null,
  latestRun: null,
  name: 'Flow',
  nextRunAt: null,
  organizationCanRun: false,
  owner: { slug: 'alice' },
  permissions: { canCopy: true, canEdit: true, canManage: true, canRun: true, canView: true, isOwner: true },
  runs: [{
    currentNodeId: null,
    error: null,
    executionUser: null,
    executionUserId: null,
    finishedAt: '2026-05-12T10:02:00.000Z',
    flowId: 'flow-1',
    id: 'run-1',
    attempt: 1,
    lastRetryError: null,
    openCodeSessionId: 'session-1',
    retryScheduledFor: null,
    scheduledFor: '2026-05-12T10:00:00.000Z',
    sessionTitle: 'Flow | Flow',
    startedAt: '2026-05-12T10:00:00.000Z',
    status: 'succeeded',
    steps: [{
      compactedOutput: 'Compact result',
      createdAt: '2026-05-12T10:00:00.000Z',
      error: null,
      finishedAt: '2026-05-12T10:02:00.000Z',
      humanResponse: null,
      id: 'step-1',
      input: null,
      nodeId: 'agent-1',
      nodeName: 'Agent',
      nodeType: 'agent',
      rawOutput: 'Raw result',
      startedAt: '2026-05-12T10:00:00.000Z',
      status: 'succeeded',
      updatedAt: '2026-05-12T10:02:00.000Z',
    }],
    trigger: 'manual',
  }],
  timezone: 'UTC',
  updatedAt: '2026-05-12T10:00:00.000Z',
  visibility: 'private',
}

describe('FlowRunHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => cleanup())

  it('renders run history and session link', () => {
    render(<FlowRunHistory flow={flow} slug="alice" />)

    expect(screen.getByText('Succeeded')).toBeTruthy()
    expect(screen.getByText('Compact: Compact result')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open session' }).getAttribute('href')).toBe('/w/alice?mode=flows&session=session-1')
  })

  it('renders scheduled retry metadata', () => {
    render(<FlowRunHistory flow={{
      ...flow,
      runs: [{
        ...flow.runs[0],
        attempt: 2,
        lastRetryError: 'instance_unavailable',
        retryScheduledFor: '2026-05-12T10:05:00.000Z',
        status: 'running',
      }],
    }} slug="alice" />)

    expect(screen.getByText(/Retry attempt 2 scheduled/)).toBeTruthy()
    expect(screen.getByText('Last retry error: instance_unavailable')).toBeTruthy()
  })

  it('renders empty history', () => {
    render(<FlowRunHistory flow={{ ...flow, runs: [] }} slug="alice" />)

    expect(screen.getByText('No runs recorded yet.')).toBeTruthy()
  })

  it('surfaces a rejected card Stop request', async () => {
    clientMocks.cancelFlowRunRequest.mockResolvedValue({ ok: false, error: 'forbidden' })
    render(<FlowRunHistory flow={{
      ...flow,
      runs: [{
        ...flow.runs[0]!,
        executionUser: { slug: 'alice' },
        finishedAt: null,
        status: 'running',
      }],
    }} slug="alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('forbidden')).toBeTruthy()
  })

  it('surfaces a card Stop network failure', async () => {
    clientMocks.cancelFlowRunRequest.mockRejectedValue(new Error('offline'))
    render(<FlowRunHistory flow={{
      ...flow,
      runs: [{
        ...flow.runs[0]!,
        executionUser: { slug: 'alice' },
        finishedAt: null,
        status: 'running',
      }],
    }} slug="alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Network error. Try again.')).toBeTruthy()
  })
})
