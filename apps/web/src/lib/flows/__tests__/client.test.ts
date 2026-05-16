import { afterEach, describe, expect, it, vi } from 'vitest'

import { cancelFlowRunRequest, createFlowRequest, deleteFlowRequest, fetchFlowDetail, fetchFlowList, fetchFlowRunRequest, runFlowRequest, submitHumanResponseRequest, updateFlowRequest } from '@/lib/flows/client'
import type { FlowDetail, FlowListItem, FlowRunListItem } from '@/lib/flows/types'

const flow: FlowListItem = {
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
  timezone: 'UTC',
  updatedAt: '2026-05-12T10:00:00.000Z',
}

const flowRun: FlowRunListItem = {
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
  sessionTitle: 'Flow | Flow',
  startedAt: '2026-05-12T10:00:00.000Z',
  status: 'waiting_for_human',
  steps: [],
  trigger: 'manual',
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('flow client helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and validates the flow list response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flows: [flow] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchFlowList('alice')).resolves.toEqual({ ok: true, data: { flows: [flow] } })
    expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/flows', { cache: 'no-store' })
  })

  it('returns invalid_response for malformed success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    await expect(fetchFlowList('alice')).resolves.toEqual({ ok: false, error: 'invalid_response' })
  })

  it('returns server error payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'flow_busy' }, { status: 409 })))

    await expect(runFlowRequest('alice', 'flow-1')).resolves.toEqual({ ok: false, error: 'flow_busy' })
  })

  it('loads flow detail and updates flows through typed requests', async () => {
    const detail: FlowDetail = { ...flow, runs: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ flow: detail }))
      .mockResolvedValueOnce(jsonResponse({ run: flowRun }))
      .mockResolvedValueOnce(jsonResponse({ flow: detail }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchFlowDetail('alice', 'flow-1')).resolves.toEqual({ ok: true, data: { flow: detail } })
    await expect(fetchFlowRunRequest('alice', 'run-1')).resolves.toEqual({ ok: true, data: { run: flowRun } })
    await expect(updateFlowRequest('alice', 'flow-1', { enabled: true })).resolves.toEqual({ ok: true, data: { flow: detail } })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/u/alice/flows/flow-1', {
      body: JSON.stringify({ enabled: true }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
  })

  it('creates, deletes, runs, and submits human responses', async () => {
    const detail: FlowDetail = { ...flow, runs: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ flow: detail }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createFlowRequest('alice', {
      cronExpression: null,
      definition: flow.definition,
      description: null,
      enabled: false,
      name: 'Flow',
      timezone: 'UTC',
    })).resolves.toEqual({ ok: true, data: { flow: detail } })
    await expect(deleteFlowRequest('alice', 'flow-1')).resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(runFlowRequest('alice', 'flow-1')).resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(cancelFlowRunRequest('alice', 'run-1')).resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(submitHumanResponseRequest('alice', 'run-1', 'Approved')).resolves.toEqual({ ok: true, data: { ok: true } })
  })
})
