import { FlowNodeType, FlowRunStatus, FlowRunStepStatus, FlowRunTrigger } from '@prisma/client'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultFlowDefinition } from '@/lib/flows/validation'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  cancelRunByIdAndUserId: vi.fn(),
  createFlow: vi.fn(),
  deleteFlowByIdAndUserId: vi.fn(),
  findFlowByIdAndUserId: vi.fn(),
  findIdBySlug: vi.fn(),
  findRunByIdAndUserId: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  getSession: vi.fn(),
  isDesktop: vi.fn(),
  listFlowsByUserId: vi.fn(),
  listRunsByFlowIdAndUserId: vi.fn(),
  resumeFlowRun: vi.fn(),
  triggerFlowNow: vi.fn(),
  updateFlowByIdAndUserId: vi.fn(),
  validateDesktopToken: vi.fn(),
  validateFlowPayload: vi.fn(),
  validateFlowSlackNodeAccess: vi.fn(),
  validateSameOrigin: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/flows/payload', () => ({ validateFlowPayload: mocks.validateFlowPayload }))
vi.mock('@/lib/flows/route-auth', () => ({ validateFlowSlackNodeAccess: mocks.validateFlowSlackNodeAccess }))
vi.mock('@/lib/flows/runner', () => ({
  resumeFlowRun: mocks.resumeFlowRun,
  triggerFlowNow: mocks.triggerFlowNow,
}))
vi.mock('@/lib/services', () => ({
  flowService: {
    cancelRunByIdAndUserId: mocks.cancelRunByIdAndUserId,
    createFlow: mocks.createFlow,
    deleteFlowByIdAndUserId: mocks.deleteFlowByIdAndUserId,
    findFlowByIdAndUserId: mocks.findFlowByIdAndUserId,
    findRunByIdAndUserId: mocks.findRunByIdAndUserId,
    listFlowsByUserId: mocks.listFlowsByUserId,
    listRunsByFlowIdAndUserId: mocks.listRunsByFlowIdAndUserId,
    updateFlowByIdAndUserId: mocks.updateFlowByIdAndUserId,
  },
  userService: { findIdBySlug: mocks.findIdBySlug },
}))

import { GET as GET_FLOWS, POST as POST_FLOW } from '../route'
import { DELETE as DELETE_FLOW, GET as GET_FLOW, PATCH as PATCH_FLOW } from '../[id]/route'
import { POST as POST_RUN_FLOW } from '../[id]/run/route'
import { GET as GET_FLOW_RUNS } from '../[id]/runs/route'
import { POST as POST_CANCEL_RUN } from '../runs/[runId]/cancel/route'
import { POST as POST_HUMAN_RESPONSE } from '../runs/[runId]/human-response/route'
import { GET as GET_RUN } from '../runs/[runId]/route'

const SESSION = {
  sessionId: 'session-1',
  user: { email: 'alice@example.com', id: 'user-1', role: 'USER', slug: 'alice' },
}
const now = new Date('2026-05-12T10:00:00.000Z')

function createFlowRecord() {
  return {
    createdAt: now,
    cronExpression: null,
    definition: createDefaultFlowDefinition(),
    description: null,
    deletedAt: null,
    enabled: false,
    id: 'flow-1',
    lastRunAt: null,
    leaseExpiresAt: null,
    leaseOwner: null,
    name: 'Flow',
    nextRunAt: null,
    runs: [createRunRecord()],
    timezone: 'UTC',
    updatedAt: now,
    userId: 'user-1',
  }
}

function createRunRecord() {
  return {
    createdAt: now,
    currentNodeId: null,
    error: null,
    finishedAt: now,
    flow: {
      createdAt: now,
      cronExpression: null,
      definition: createDefaultFlowDefinition(),
      description: null,
      deletedAt: null,
      enabled: false,
      id: 'flow-1',
      lastRunAt: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      name: 'Flow',
      nextRunAt: null,
      timezone: 'UTC',
      updatedAt: now,
      userId: 'user-1',
    },
    flowId: 'flow-1',
    id: 'run-1',
    attempt: 1,
    lastRetryError: null,
    openCodeSessionId: 'opencode-1',
    retryScheduledFor: null,
    resultSeenAt: null,
    scheduledFor: now,
    sessionTitle: 'Flow | Flow',
    startedAt: now,
    status: FlowRunStatus.succeeded,
    steps: [{
      compactedOutput: null,
      createdAt: now,
      error: null,
      finishedAt: now,
      humanResponse: null,
      id: 'step-1',
      input: { prompt: 'Hello' },
      nodeId: 'agent-1',
      nodeName: 'Agent',
      nodeType: FlowNodeType.agent,
      rawOutput: 'Done',
      runId: 'run-1',
      startedAt: now,
      status: FlowRunStepStatus.succeeded,
      updatedAt: now,
    }],
    trigger: FlowRunTrigger.manual,
    updatedAt: now,
  }
}

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    method,
  })
}

function params<P extends Record<string, string>>(value: P) {
  return { params: Promise.resolve(value) }
}

describe('Flow API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: true, flows: true })
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.isDesktop.mockReturnValue(false)
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateFlowSlackNodeAccess.mockResolvedValue({ ok: true })
    mocks.findIdBySlug.mockResolvedValue({ id: 'user-1' })
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.validateFlowPayload.mockResolvedValue({
      ok: true,
      value: {
        cronExpression: null,
        definition: createDefaultFlowDefinition(),
        description: null,
        enabled: false,
        name: 'Flow',
        timezone: 'UTC',
      },
    })
  })

  it('lists flows for the authenticated owner', async () => {
    mocks.listFlowsByUserId.mockResolvedValue([createFlowRecord()])

    const response = await GET_FLOWS(request('/api/u/alice/flows'), params({ slug: 'alice' }))
    const body = await response.json()

    expect(body.flows).toHaveLength(1)
    expect(mocks.listFlowsByUserId).toHaveBeenCalledWith('user-1')
  })

  it('creates flows and audits the write', async () => {
    const flow = createFlowRecord()
    mocks.createFlow.mockResolvedValue(flow)
    mocks.findFlowByIdAndUserId.mockResolvedValue(flow)

    const response = await POST_FLOW(request('/api/u/alice/flows', 'POST', { name: 'Flow' }), params({ slug: 'alice' }))

    expect(response.status).toBe(201)
    expect(mocks.createFlow).toHaveBeenCalled()
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'flows.flow_created' }))
  })

  it('triggers enabled flows after creation and logs trigger failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const flow = { ...createFlowRecord(), cronExpression: '0 9 * * 1', enabled: true }
    mocks.validateFlowPayload.mockResolvedValue({
      ok: true,
      value: {
        cronExpression: '0 9 * * 1',
        definition: createDefaultFlowDefinition(),
        description: null,
        enabled: true,
        name: 'Flow',
        timezone: 'UTC',
      },
    })
    mocks.createFlow.mockResolvedValue(flow)
    mocks.findFlowByIdAndUserId.mockResolvedValue(flow)
    mocks.triggerFlowNow.mockResolvedValue({ ok: false, error: 'flow_busy' })

    const response = await POST_FLOW(request('/api/u/alice/flows', 'POST', { name: 'Flow' }), params({ slug: 'alice' }))

    expect(response.status).toBe(201)
    expect(mocks.triggerFlowNow).toHaveBeenCalledWith({ flowId: 'flow-1', trigger: 'on_create', userId: 'user-1' })
    expect(consoleError).toHaveBeenCalledWith('[flows] Failed to trigger initial flow run', expect.objectContaining({ flowId: 'flow-1', reason: 'flow_busy' }))
  })

  it('rejects invalid create requests before writing', async () => {
    mocks.validateFlowPayload.mockResolvedValueOnce({ ok: false, error: 'invalid_name', status: 400 })

    expect((await POST_FLOW(request('/api/u/alice/flows', 'POST', { name: '' }), params({ slug: 'alice' }))).status).toBe(400)
    expect((await POST_FLOW(request('/api/u/alice/flows', 'POST', undefined), params({ slug: 'alice' }))).status).toBe(400)
  })

  it('maps create authorization and detail lookup failures', async () => {
    const flow = createFlowRecord()
    mocks.validateFlowSlackNodeAccess.mockResolvedValueOnce({ ok: false, error: 'slack_integration_disabled', status: 400 })
    expect((await POST_FLOW(request('/api/u/alice/flows', 'POST', { name: 'Flow' }), params({ slug: 'alice' }))).status).toBe(400)

    mocks.createFlow.mockResolvedValue(flow)
    mocks.findFlowByIdAndUserId.mockResolvedValue(null)
    expect((await POST_FLOW(request('/api/u/alice/flows', 'POST', { name: 'Flow' }), params({ slug: 'alice' }))).status).toBe(404)
  })

  it('reads, updates, and deletes a flow', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdAndUserId.mockResolvedValue(flow)
    mocks.updateFlowByIdAndUserId.mockResolvedValue(flow)
    mocks.deleteFlowByIdAndUserId.mockResolvedValue({ count: 1 })

    await expect((await GET_FLOW(request('/api/u/alice/flows/flow-1'), params({ id: 'flow-1', slug: 'alice' }))).json())
      .resolves.toMatchObject({ flow: { id: 'flow-1' } })
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(200)
    expect((await DELETE_FLOW(request('/api/u/alice/flows/flow-1', 'DELETE'), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(200)
  })

  it('rejects invalid updates before writing', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdAndUserId.mockResolvedValue(flow)
    mocks.validateFlowPayload.mockResolvedValueOnce({ ok: false, error: 'invalid_name', status: 400 })

    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: '' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(400)
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', undefined), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(400)
  })

  it('validates update schedules and Slack node targets', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdAndUserId.mockResolvedValue(flow)
    mocks.validateFlowPayload.mockResolvedValueOnce({
      ok: true,
      value: { enabled: true, name: 'Flow' },
    })
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { enabled: true }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(400)

    mocks.validateFlowPayload.mockResolvedValueOnce({
      ok: true,
      value: { cronExpression: 'not cron', enabled: true, name: 'Flow', timezone: 'UTC' },
    })
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { cronExpression: 'not cron', enabled: true }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(400)

    mocks.validateFlowPayload.mockResolvedValueOnce({
      ok: true,
      value: { definition: createDefaultFlowDefinition(), name: 'Flow' },
    })
    mocks.validateFlowSlackNodeAccess.mockResolvedValueOnce({ ok: false, error: 'slack_notification_dm_target_forbidden', status: 403 })
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(403)
  })

  it('clears schedules on update', async () => {
    const flow = { ...createFlowRecord(), cronExpression: '0 9 * * 1', enabled: true }
    const updated = { ...flow, cronExpression: null, enabled: false, nextRunAt: null }
    mocks.findFlowByIdAndUserId.mockResolvedValueOnce(flow).mockResolvedValueOnce(updated)
    mocks.updateFlowByIdAndUserId.mockResolvedValue(updated)
    mocks.validateFlowPayload.mockResolvedValue({
      ok: true,
      value: { cronExpression: null, enabled: false, name: 'Flow' },
    })

    const response = await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { enabled: false }), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(200)
    expect(mocks.updateFlowByIdAndUserId).toHaveBeenCalledWith('flow-1', 'user-1', expect.objectContaining({
      nextRunAt: null,
    }))
  })

  it('maps update and delete misses to not found', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdAndUserId.mockResolvedValueOnce(null)
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(404)

    mocks.findFlowByIdAndUserId.mockResolvedValueOnce(flow).mockResolvedValueOnce(null)
    mocks.updateFlowByIdAndUserId.mockResolvedValue(flow)
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(404)

    mocks.deleteFlowByIdAndUserId.mockResolvedValue({ count: 0 })
    expect((await DELETE_FLOW(request('/api/u/alice/flows/flow-1', 'DELETE'), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(404)
  })

  it('starts manual runs and maps busy responses', async () => {
    mocks.triggerFlowNow.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'flow_busy' })

    const accepted = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))
    const busy = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(accepted.status).toBe(202)
    expect(busy.status).toBe(409)
  })

  it('lists run history and reads run detail', async () => {
    const flow = createFlowRecord()
    const run = createRunRecord()
    mocks.findFlowByIdAndUserId.mockResolvedValue(flow)
    mocks.listRunsByFlowIdAndUserId.mockResolvedValue([run])
    mocks.findRunByIdAndUserId.mockResolvedValue(run)

    await expect((await GET_FLOW_RUNS(request('/api/u/alice/flows/flow-1/runs'), params({ id: 'flow-1', slug: 'alice' }))).json())
      .resolves.toMatchObject({ runs: [{ id: 'run-1' }] })
    await expect((await GET_RUN(request('/api/u/alice/flows/runs/run-1'), params({ runId: 'run-1', slug: 'alice' }))).json())
      .resolves.toMatchObject({ run: { id: 'run-1' } })
  })

  it('cancels runs and resumes human responses', async () => {
    mocks.cancelRunByIdAndUserId.mockResolvedValue(true)
    mocks.resumeFlowRun.mockResolvedValue({ ok: true, run: createRunRecord() })

    expect((await POST_CANCEL_RUN(request('/api/u/alice/flows/runs/run-1/cancel', 'POST'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(200)
    expect((await POST_HUMAN_RESPONSE(request('/api/u/alice/flows/runs/run-1/human-response', 'POST', { response: 'Approved' }), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(202)
  })

  it('rejects invalid human responses and maps resume failures', async () => {
    expect((await POST_HUMAN_RESPONSE(request('/api/u/alice/flows/runs/run-1/human-response', 'POST', { response: 42 }), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(400)
    expect((await POST_HUMAN_RESPONSE(request('/api/u/alice/flows/runs/run-1/human-response', 'POST', undefined), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(400)

    mocks.resumeFlowRun.mockResolvedValue({ ok: false, error: 'flow_busy' })
    expect((await POST_HUMAN_RESPONSE(request('/api/u/alice/flows/runs/run-1/human-response', 'POST', { response: 'Approved' }), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(409)
  })
})
