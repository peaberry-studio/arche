/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FlowRunHistory } from '@/components/flows/flow-run-history'
import type { FlowDetail } from '@/lib/flows/types'

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
  runs: [{
    currentNodeId: null,
    error: null,
    finishedAt: '2026-05-12T10:02:00.000Z',
    flowId: 'flow-1',
    id: 'run-1',
    openCodeSessionId: 'session-1',
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
}

describe('FlowRunHistory', () => {
  afterEach(() => cleanup())

  it('renders run history and session link', () => {
    render(<FlowRunHistory flow={flow} slug="alice" />)

    expect(screen.getByText('Run history')).toBeTruthy()
    expect(screen.getAllByText('succeeded').length).toBeGreaterThan(0)
    expect(screen.getByText('Compact: Compact result')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open session' }).getAttribute('href')).toBe('/w/alice?mode=flows&session=session-1')
  })

  it('renders empty history', () => {
    render(<FlowRunHistory flow={{ ...flow, runs: [] }} slug="alice" />)

    expect(screen.getByText('No runs recorded yet.')).toBeTruthy()
  })
})
