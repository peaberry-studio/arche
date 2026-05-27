import { FlowNodeType, FlowRunStatus, FlowRunStepStatus, FlowRunTrigger, Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultFlowDefinition } from '@/lib/flows/validation'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  cancelRunById: vi.fn(),
  cancelRunByIdForScope: vi.fn(),
  checkMissingConnectorRequirements: vi.fn(),
  createFlow: vi.fn(),
  deleteFlowByIdAndOwnerId: vi.fn(),
  findFlowByIdForScope: vi.fn(),
  findIdBySlug: vi.fn(),
  findIntegration: vi.fn(),
  findRunByIdForScope: vi.fn(),
  findTeamMemberById: vi.fn(),
  getFlowConnectorRequirements: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  getSession: vi.fn(),
  isDesktop: vi.fn(),
  listEnabledNotificationChannels: vi.fn(),
  listFlowAgentOptions: vi.fn(),
  listFlowsForScope: vi.fn(),
  listRunsByFlowIdForScope: vi.fn(),
  resumeFlowRun: vi.fn(),
  triggerFlowNow: vi.fn(),
  updateFlowByIdAndOwnerId: vi.fn(),
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
vi.mock('@/lib/flows/connector-requirements', () => ({
  checkMissingConnectorRequirements: mocks.checkMissingConnectorRequirements,
  getFlowConnectorRequirements: mocks.getFlowConnectorRequirements,
}))
vi.mock('@/lib/flows/agents', () => ({ listFlowAgentOptions: mocks.listFlowAgentOptions }))
vi.mock('@/lib/flows/payload', () => ({ validateFlowPayload: mocks.validateFlowPayload }))
vi.mock('@/lib/flows/route-auth', () => ({ validateFlowSlackNodeAccess: mocks.validateFlowSlackNodeAccess }))
vi.mock('@/lib/flows/runner', () => ({
  resumeFlowRun: mocks.resumeFlowRun,
  triggerFlowNow: mocks.triggerFlowNow,
}))
vi.mock('@/lib/services', () => ({
  flowService: {
    cancelRunById: mocks.cancelRunById,
    cancelRunByIdForScope: mocks.cancelRunByIdForScope,
    createFlow: mocks.createFlow,
    deleteFlowByIdAndOwnerId: mocks.deleteFlowByIdAndOwnerId,
    findFlowByIdForScope: mocks.findFlowByIdForScope,
    findRunByIdForScope: mocks.findRunByIdForScope,
    listFlowsForScope: mocks.listFlowsForScope,
    listRunsByFlowIdForScope: mocks.listRunsByFlowIdForScope,
    updateFlowByIdAndOwnerId: mocks.updateFlowByIdAndOwnerId,
  },
  slackService: {
    findIntegration: mocks.findIntegration,
    listEnabledNotificationChannels: mocks.listEnabledNotificationChannels,
  },
  userService: {
    findIdBySlug: mocks.findIdBySlug,
    findTeamMemberById: mocks.findTeamMemberById,
  },
}))

import { GET as GET_FLOWS, POST as POST_FLOW } from '../route'
import { DELETE as DELETE_FLOW, GET as GET_FLOW, PATCH as PATCH_FLOW } from '../[id]/route'
import { POST as POST_COPY_FLOW } from '../[id]/copy/route'
import { GET as GET_FLOW_EXPORT } from '../[id]/export/route'
import { POST as POST_RUN_FLOW } from '../[id]/run/route'
import { GET as GET_FLOW_RUNS } from '../[id]/runs/route'
import { POST as POST_IMPORT_VALIDATE } from '../import/validate/route'
import { POST as POST_CANCEL_RUN } from '../runs/[runId]/cancel/route'
import { POST as POST_HUMAN_RESPONSE } from '../runs/[runId]/human-response/route'
import { GET as GET_RUN } from '../runs/[runId]/route'

const SESSION = {
  sessionId: 'session-1',
  user: { email: 'alice@example.com', id: 'user-1', role: 'USER', slug: 'alice' },
}
const now = new Date('2026-05-12T10:00:00.000Z')

function createFlowRecord(overrides: Record<string, unknown> = {}) {
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
    organizationCanRun: false,
    runs: [createRunRecord()],
    timezone: 'UTC',
    updatedAt: now,
    user: { email: 'alice@example.com', slug: 'alice' },
    userId: 'user-1',
    visibility: 'private',
    ...overrides,
  }
}

function createRunRecord(overrides: Record<string, unknown> = {}) {
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
      organizationCanRun: false,
      timezone: 'UTC',
      updatedAt: now,
      user: { email: 'alice@example.com', slug: 'alice' },
      userId: 'user-1',
      visibility: 'private',
    },
    flowId: 'flow-1',
    id: 'run-1',
    attempt: 1,
    lastRetryError: null,
    executionUser: null,
    executionUserId: null,
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
    ...overrides,
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
    mocks.getFlowConnectorRequirements.mockResolvedValue({ ok: true, requirements: [] })
    mocks.checkMissingConnectorRequirements.mockResolvedValue([])
    mocks.findIdBySlug.mockResolvedValue({ id: 'user-1' })
    mocks.findIntegration.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })
    mocks.findFlowByIdForScope.mockResolvedValue(createFlowRecord())
    mocks.findTeamMemberById.mockResolvedValue({ id: 'user-1' })
    mocks.findRunByIdForScope.mockResolvedValue(createRunRecord())
    mocks.listEnabledNotificationChannels.mockResolvedValue([])
    mocks.listFlowAgentOptions.mockResolvedValue({ ok: true, agents: [] })
    mocks.listFlowsForScope.mockResolvedValue([])
    mocks.cancelRunById.mockResolvedValue(true)
    mocks.cancelRunByIdForScope.mockResolvedValue(true)
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.validateFlowPayload.mockResolvedValue({
      ok: true,
      value: {
        cronExpression: null,
        definition: createDefaultFlowDefinition(),
        description: null,
        enabled: false,
        name: 'Flow',
        organizationCanRun: false,
        timezone: 'UTC',
        visibility: 'private',
      },
    })
  })

  it('lists flows for the authenticated owner', async () => {
    mocks.listFlowsForScope.mockResolvedValue([createFlowRecord()])

    const response = await GET_FLOWS(request('/api/u/alice/flows'), params({ slug: 'alice' }))
    const body = await response.json()

    expect(body.flows).toHaveLength(1)
    expect(mocks.listFlowsForScope).toHaveBeenCalledWith(expect.objectContaining({ workspaceUserId: 'user-1' }))
  })

  it('blocks non-admin actors from another user flow workspace', async () => {
    const response = await GET_FLOWS(request('/api/u/bob/flows'), params({ slug: 'bob' }))

    expect(response.status).toBe(403)
    expect(mocks.listFlowsForScope).not.toHaveBeenCalled()
  })

  it('creates flows and audits the write', async () => {
    const flow = createFlowRecord()
    mocks.createFlow.mockResolvedValue(flow)
    mocks.findFlowByIdForScope.mockResolvedValue(flow)

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
    mocks.findFlowByIdForScope.mockResolvedValue(flow)
    mocks.triggerFlowNow.mockResolvedValue({ ok: false, error: 'flow_busy' })

    const response = await POST_FLOW(request('/api/u/alice/flows', 'POST', { name: 'Flow' }), params({ slug: 'alice' }))

    expect(response.status).toBe(201)
    expect(mocks.triggerFlowNow).toHaveBeenCalledWith({ executionUserId: 'user-1', flowId: 'flow-1', ownerUserId: 'user-1', trigger: 'on_create' })
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
    mocks.findFlowByIdForScope.mockResolvedValue(null)
    expect((await POST_FLOW(request('/api/u/alice/flows', 'POST', { name: 'Flow' }), params({ slug: 'alice' }))).status).toBe(404)
  })

  it('reads, updates, and deletes a flow', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdForScope.mockResolvedValue(flow)
    mocks.updateFlowByIdAndOwnerId.mockResolvedValue(flow)
    mocks.deleteFlowByIdAndOwnerId.mockResolvedValue({ count: 1 })

    await expect((await GET_FLOW(request('/api/u/alice/flows/flow-1'), params({ id: 'flow-1', slug: 'alice' }))).json())
      .resolves.toMatchObject({ flow: { id: 'flow-1' } })
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(200)
    expect((await DELETE_FLOW(request('/api/u/alice/flows/flow-1', 'DELETE'), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(200)
  })

  it('exports visible flows as portable JSON templates and audits the export', async () => {
    const flow = createFlowRecord({
      cronExpression: '0 9 * * 1',
      enabled: true,
      name: 'Weekly Review',
      timezone: 'Europe/Madrid',
    })
    mocks.findFlowByIdForScope.mockResolvedValue(flow)

    const response = await GET_FLOW_EXPORT(request('/api/u/alice/flows/flow-1/export'), params({ id: 'flow-1', slug: 'alice' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('weekly-review-template.json')
    expect(body).toMatchObject({
      cronExpression: '0 9 * * 1',
      enabled: true,
      format: 'arche-flow-template/v1',
      name: 'Weekly Review',
      timezone: 'Europe/Madrid',
    })
    expect(body).not.toHaveProperty('id')
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'flows.flow_exported' }))
  })

  it('validates imported flow templates and returns draft warnings', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = definition.nodes.map((node) => (
      node.type === 'agent' ? { ...node, targetAgentId: 'missing-agent' } : node
    ))
    mocks.listFlowsForScope.mockResolvedValue([createFlowRecord({ name: 'Flow' })])

    const response = await POST_IMPORT_VALIDATE(request('/api/u/alice/flows/import/validate', 'POST', {
      cronExpression: null,
      definition,
      enabled: true,
      format: 'arche-flow-template/v1',
      name: 'Flow',
      timezone: 'UTC',
    }), params({ slug: 'alice' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.draftPayload).toMatchObject({
      enabled: true,
      name: 'Flow',
      organizationCanRun: false,
      visibility: 'private',
    })
    expect(body.warnings.map((warning: { code: string }) => warning.code)).toEqual([
      'schedule_required',
      'flow_name_exists',
      'unknown_target_agent',
    ])
  })

  it('returns import warnings when agent availability cannot be checked', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = definition.nodes.map((node) => (
      node.type === 'agent' ? { ...node, targetAgentId: 'agent-1' } : node
    ))
    mocks.listFlowAgentOptions.mockResolvedValueOnce({ ok: false, error: 'kb_unavailable' })

    const response = await POST_IMPORT_VALIDATE(request('/api/u/alice/flows/import/validate', 'POST', {
      cronExpression: null,
      definition,
      enabled: false,
      format: 'arche-flow-template/v1',
      name: 'Agent check',
      timezone: 'UTC',
    }), params({ slug: 'alice' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.warnings).toContainEqual(expect.objectContaining({ code: 'agent_options_unavailable' }))
  })

  it('maps invalid import bodies to bad requests', async () => {
    const invalidJson = await POST_IMPORT_VALIDATE(new NextRequest('http://localhost/api/u/alice/flows/import/validate', {
      body: '{not json',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }), params({ slug: 'alice' }))
    const invalidTemplate = await POST_IMPORT_VALIDATE(request('/api/u/alice/flows/import/validate', 'POST', {
      format: 'other',
    }), params({ slug: 'alice' }))

    expect(invalidJson.status).toBe(400)
    await expect(invalidJson.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(invalidTemplate.status).toBe(400)
    await expect(invalidTemplate.json()).resolves.toEqual({ error: 'invalid_flow_template_format' })
  })

  it('returns Slack import warnings from the shared Slack target analysis', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = [{
      id: 'slack-1',
      messageMode: 'fixed',
      messageTemplate: 'Heads up',
      name: 'Notify private channel',
      target: { channelId: 'C-private', type: 'channel' },
      type: 'slack',
    }]
    definition.layout = { nodes: [{ nodeId: 'slack-1', x: 120, y: 120 }] }
    definition.startNodeId = 'slack-1'
    mocks.listEnabledNotificationChannels.mockResolvedValue([{ channelId: 'C-private', isPrivate: true }])

    const response = await POST_IMPORT_VALIDATE(request('/api/u/alice/flows/import/validate', 'POST', {
      cronExpression: null,
      definition,
      enabled: false,
      format: 'arche-flow-template/v1',
      name: 'Slack flow',
      timezone: 'UTC',
    }), params({ slug: 'alice' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.warnings).toContainEqual(expect.objectContaining({
      code: 'slack_private_channel_forbidden',
      nodeId: 'slack-1',
      value: 'C-private',
    }))
  })

  it('returns Slack import warning variants for unavailable targets', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = [
      {
        id: 'slack-dm',
        messageMode: 'fixed',
        messageTemplate: 'DM update',
        name: 'Notify DM',
        target: { type: 'dm', userId: 'user-2' },
        type: 'slack',
      },
      {
        id: 'slack-channel',
        messageMode: 'fixed',
        messageTemplate: 'Channel update',
        name: 'Notify channel',
        target: { channelId: 'C-missing', type: 'channel' },
        type: 'slack',
      },
    ]
    definition.layout = { nodes: [] }
    definition.startNodeId = 'slack-dm'

    const response = await POST_IMPORT_VALIDATE(request('/api/u/alice/flows/import/validate', 'POST', {
      cronExpression: null,
      definition,
      enabled: false,
      format: 'arche-flow-template/v1',
      name: 'Slack targets',
      timezone: 'UTC',
    }), params({ slug: 'alice' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'slack_dm_target_forbidden', nodeId: 'slack-dm', value: 'user-2' }),
      expect.objectContaining({ code: 'unknown_slack_channel_target', nodeId: 'slack-channel', value: 'C-missing' }),
    ]))
  })

  it('returns Slack import warnings when integration or admin DM targets are unavailable', async () => {
    const disabledDefinition = createDefaultFlowDefinition()
    disabledDefinition.nodes = [{
      id: 'slack-1',
      messageMode: 'fixed',
      messageTemplate: 'Heads up',
      name: 'Notify Slack',
      target: { channelId: 'C1', type: 'channel' },
      type: 'slack',
    }]
    disabledDefinition.layout = { nodes: [] }
    disabledDefinition.startNodeId = 'slack-1'
    mocks.findIntegration.mockResolvedValueOnce({ enabled: false, slackTeamId: null })

    const disabledResponse = await POST_IMPORT_VALIDATE(request('/api/u/alice/flows/import/validate', 'POST', {
      cronExpression: null,
      definition: disabledDefinition,
      enabled: false,
      format: 'arche-flow-template/v1',
      name: 'Slack disabled',
      timezone: 'UTC',
    }), params({ slug: 'alice' }))
    const disabledBody = await disabledResponse.json()

    mocks.getSession.mockResolvedValue({
      sessionId: 'session-admin',
      user: { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'admin' },
    })
    mocks.findTeamMemberById.mockResolvedValueOnce(null)

    const dmDefinition = createDefaultFlowDefinition()
    dmDefinition.nodes = [{
      id: 'slack-dm',
      messageMode: 'fixed',
      messageTemplate: 'DM update',
      name: 'Notify DM',
      target: { type: 'dm', userId: 'missing-user' },
      type: 'slack',
    }]
    dmDefinition.layout = { nodes: [] }
    dmDefinition.startNodeId = 'slack-dm'

    const dmResponse = await POST_IMPORT_VALIDATE(request('/api/u/alice/flows/import/validate', 'POST', {
      cronExpression: null,
      definition: dmDefinition,
      enabled: false,
      format: 'arche-flow-template/v1',
      name: 'Slack DM',
      timezone: 'UTC',
    }), params({ slug: 'alice' }))
    const dmBody = await dmResponse.json()

    expect(disabledResponse.status).toBe(200)
    expect(disabledBody.warnings).toContainEqual(expect.objectContaining({ code: 'slack_integration_disabled' }))
    expect(dmResponse.status).toBe(200)
    expect(dmBody.warnings).toContainEqual(expect.objectContaining({ code: 'unknown_slack_dm_target', nodeId: 'slack-dm', value: 'missing-user' }))
  })

  it('rejects invalid updates before writing', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdForScope.mockResolvedValue(flow)
    mocks.validateFlowPayload.mockResolvedValueOnce({ ok: false, error: 'invalid_name', status: 400 })

    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: '' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(400)
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', undefined), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(400)
  })

  it('validates update schedules and Slack node targets', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdForScope.mockResolvedValue(flow)
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

  it('blocks non-owners from updating team-visible flows', async () => {
    mocks.findFlowByIdForScope.mockResolvedValue({
      ...createFlowRecord(),
      organizationCanRun: true,
      userId: 'user-2',
      visibility: 'team',
    })

    const response = await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(403)
    expect(mocks.updateFlowByIdAndOwnerId).not.toHaveBeenCalled()
  })

  it('clears schedules on update', async () => {
    const flow = { ...createFlowRecord(), cronExpression: '0 9 * * 1', enabled: true }
    const updated = { ...flow, cronExpression: null, enabled: false, nextRunAt: null }
    mocks.findFlowByIdForScope.mockResolvedValueOnce(flow).mockResolvedValueOnce(updated)
    mocks.updateFlowByIdAndOwnerId.mockResolvedValue(updated)
    mocks.validateFlowPayload.mockResolvedValue({
      ok: true,
      value: { cronExpression: null, enabled: false, name: 'Flow' },
    })

    const response = await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { enabled: false }), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(200)
    expect(mocks.updateFlowByIdAndOwnerId).toHaveBeenCalledWith('flow-1', 'user-1', expect.objectContaining({
      nextRunAt: null,
    }))
  })

  it('maps update and delete misses to not found', async () => {
    const flow = createFlowRecord()
    mocks.findFlowByIdForScope.mockResolvedValueOnce(null)
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(404)

    mocks.findFlowByIdForScope.mockResolvedValueOnce(flow).mockResolvedValueOnce(null)
    mocks.updateFlowByIdAndOwnerId.mockResolvedValue(flow)
    expect((await PATCH_FLOW(request('/api/u/alice/flows/flow-1', 'PATCH', { name: 'Flow' }), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(404)

    mocks.deleteFlowByIdAndOwnerId.mockResolvedValue({ count: 0 })
    mocks.findFlowByIdForScope.mockResolvedValue(flow)
    expect((await DELETE_FLOW(request('/api/u/alice/flows/flow-1', 'DELETE'), params({ id: 'flow-1', slug: 'alice' }))).status)
      .toBe(404)
  })

  it('starts manual runs and maps busy responses', async () => {
    mocks.triggerFlowNow.mockResolvedValueOnce({ ok: true, runId: 'run-1' }).mockResolvedValueOnce({ ok: false, error: 'flow_busy' })

    const accepted = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))
    const busy = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(accepted.status).toBe(202)
    await expect(accepted.json()).resolves.toEqual({ ok: true, runId: 'run-1' })
    expect(busy.status).toBe(409)
  })

  it('runs runnable team flows as the current user after connector checks', async () => {
    mocks.findFlowByIdForScope.mockResolvedValue({
      ...createFlowRecord(),
      organizationCanRun: true,
      userId: 'user-2',
      visibility: 'team',
    })
    mocks.getFlowConnectorRequirements.mockResolvedValue({ ok: true, requirements: [{ capabilityId: 'globalzendesk' }] })
    mocks.checkMissingConnectorRequirements.mockResolvedValue([])
    mocks.triggerFlowNow.mockResolvedValue({ ok: true, runId: 'run-1' })

    const response = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(202)
    expect(mocks.checkMissingConnectorRequirements).toHaveBeenCalledWith([{ capabilityId: 'globalzendesk' }], 'user-1')
    expect(mocks.triggerFlowNow).toHaveBeenCalledWith({ executionUserId: 'user-1', flowId: 'flow-1', trigger: 'manual' })
  })

  it('runs admin-triggered manual runs as the admin invoker', async () => {
    mocks.getSession.mockResolvedValue({
      sessionId: 'session-admin',
      user: { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'admin' },
    })
    mocks.findIdBySlug.mockResolvedValue({ id: 'owner-1' })
    mocks.findFlowByIdForScope.mockResolvedValue({
      ...createFlowRecord(),
      userId: 'owner-1',
    })
    mocks.getFlowConnectorRequirements.mockResolvedValue({ ok: true, requirements: [{ capabilityId: 'globalzendesk' }] })
    mocks.checkMissingConnectorRequirements.mockResolvedValue([])
    mocks.triggerFlowNow.mockResolvedValue({ ok: true, runId: 'run-1' })

    const response = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(202)
    expect(mocks.validateFlowSlackNodeAccess).toHaveBeenCalledWith(
      expect.objectContaining({ startNodeId: 'agent-1' }),
      expect.objectContaining({ id: 'admin-1', role: 'ADMIN', slug: 'admin' }),
      'admin-1',
    )
    expect(mocks.checkMissingConnectorRequirements).toHaveBeenCalledWith([{ capabilityId: 'globalzendesk' }], 'admin-1')
    expect(mocks.triggerFlowNow).toHaveBeenCalledWith({ executionUserId: 'admin-1', flowId: 'flow-1', trigger: 'manual' })
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ executionUserId: 'admin-1', ownerUserId: 'owner-1' }),
    }))
  })

  it('blocks runnable team flows when Slack targets are forbidden for the execution user', async () => {
    mocks.findFlowByIdForScope.mockResolvedValue({
      ...createFlowRecord(),
      organizationCanRun: true,
      userId: 'user-2',
      visibility: 'team',
    })
    mocks.validateFlowSlackNodeAccess.mockResolvedValueOnce({ ok: false, error: 'slack_notification_dm_target_forbidden', status: 403 })

    const response = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(403)
    expect(mocks.getFlowConnectorRequirements).not.toHaveBeenCalled()
    expect(mocks.triggerFlowNow).not.toHaveBeenCalled()
  })

  it('validates Slack node targets for owned manual runs', async () => {
    mocks.validateFlowSlackNodeAccess.mockResolvedValueOnce({ ok: false, error: 'slack_notification_dm_target_forbidden', status: 403 })

    const response = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(403)
    expect(mocks.validateFlowSlackNodeAccess).toHaveBeenCalledWith(
      expect.objectContaining({ startNodeId: 'agent-1' }),
      SESSION.user,
      'user-1',
    )
    expect(mocks.triggerFlowNow).not.toHaveBeenCalled()
  })

  it('blocks runs when the execution user is missing required connectors', async () => {
    mocks.findFlowByIdForScope.mockResolvedValue({
      ...createFlowRecord(),
      organizationCanRun: true,
      userId: 'user-2',
      visibility: 'team',
    })
    mocks.getFlowConnectorRequirements.mockResolvedValue({ ok: true, requirements: [{ capabilityId: 'globalzendesk' }] })
    mocks.checkMissingConnectorRequirements.mockResolvedValue([{ capabilityId: 'globalzendesk', connectorType: 'zendesk' }])

    const response = await POST_RUN_FLOW(request('/api/u/alice/flows/flow-1/run', 'POST'), params({ id: 'flow-1', slug: 'alice' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ error: 'missing_connectors' })
    expect(mocks.triggerFlowNow).not.toHaveBeenCalled()
  })

  it('copies visible flows into a private unscheduled flow owned by the actor', async () => {
    const source = {
      ...createFlowRecord(),
      organizationCanRun: true,
      userId: 'user-2',
      visibility: 'team',
    }
    const copy = {
      ...createFlowRecord(),
      cronExpression: null,
      enabled: false,
      id: 'copy-1',
      name: 'Copy of Flow',
      nextRunAt: null,
      organizationCanRun: false,
      userId: 'user-1',
      visibility: 'private',
    }
    mocks.findFlowByIdForScope.mockResolvedValueOnce(source).mockResolvedValueOnce(copy)
    mocks.createFlow.mockResolvedValue(copy)

    const response = await POST_COPY_FLOW(request('/api/u/alice/flows/flow-1/copy', 'POST'), params({ id: 'flow-1', slug: 'alice' }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.flow.id).toBe('copy-1')
    expect(mocks.createFlow).toHaveBeenCalledWith(expect.objectContaining({
      cronExpression: null,
      enabled: false,
      name: 'Copy of Flow',
      nextRunAt: null,
      organizationCanRun: false,
      userId: 'user-1',
      visibility: 'private',
    }))
  })

  it('blocks copies when Slack targets are forbidden for the actor', async () => {
    mocks.validateFlowSlackNodeAccess.mockResolvedValueOnce({ ok: false, error: 'slack_notification_dm_target_forbidden', status: 403 })

    const response = await POST_COPY_FLOW(request('/api/u/alice/flows/flow-1/copy', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(403)
    expect(mocks.createFlow).not.toHaveBeenCalled()
  })

  it('maps duplicate copied flow names to conflict responses', async () => {
    mocks.createFlow.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('flow_name_exists', {
      clientVersion: 'test',
      code: 'P2002',
    }))

    const response = await POST_COPY_FLOW(request('/api/u/alice/flows/flow-1/copy', 'POST'), params({ id: 'flow-1', slug: 'alice' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'flow_name_exists' })
  })

  it('lists run history and reads run detail', async () => {
    const flow = createFlowRecord()
    const run = createRunRecord()
    mocks.findFlowByIdForScope.mockResolvedValue(flow)
    mocks.listRunsByFlowIdForScope.mockResolvedValue([run])
    mocks.findRunByIdForScope.mockResolvedValue(run)

    await expect((await GET_FLOW_RUNS(request('/api/u/alice/flows/flow-1/runs'), params({ id: 'flow-1', slug: 'alice' }))).json())
      .resolves.toMatchObject({ runs: [{ id: 'run-1' }] })
    await expect((await GET_RUN(request('/api/u/alice/flows/runs/run-1'), params({ runId: 'run-1', slug: 'alice' }))).json())
      .resolves.toMatchObject({ run: { id: 'run-1' } })
  })

  it('redacts other users shared executions from owner run history', async () => {
    const flow = createFlowRecord({ organizationCanRun: true, visibility: 'team' })
    const ownerRun = createRunRecord({ id: 'run-owner' })
    const memberRun = createRunRecord({ executionUserId: 'user-2', id: 'run-member' })
    mocks.findFlowByIdForScope.mockResolvedValue(flow)
    mocks.listRunsByFlowIdForScope.mockResolvedValue([memberRun, ownerRun])

    const response = await GET_FLOW_RUNS(request('/api/u/alice/flows/flow-1/runs'), params({ id: 'flow-1', slug: 'alice' }))
    const body = await response.json()

    expect(body.runs).toEqual([expect.objectContaining({ id: 'run-owner' })])
  })

  it('cancels runs and resumes human responses', async () => {
    mocks.cancelRunById.mockResolvedValue(true)
    mocks.resumeFlowRun.mockResolvedValue({ ok: true, run: createRunRecord() })

    expect((await POST_CANCEL_RUN(request('/api/u/alice/flows/runs/run-1/cancel', 'POST'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(200)
    expect(mocks.cancelRunByIdForScope).toHaveBeenCalledWith('run-1', expect.objectContaining({ workspaceUserId: 'user-1' }), expect.any(Date))
    expect((await POST_HUMAN_RESPONSE(request('/api/u/alice/flows/runs/run-1/human-response', 'POST', { response: 'Approved' }), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(202)
  })

  it('lets execution users read and cancel their own shared flow runs', async () => {
    mocks.findRunByIdForScope.mockResolvedValue(createRunRecord({
      executionUserId: 'user-1',
      flow: {
        ...createFlowRecord(),
        organizationCanRun: true,
        userId: 'user-2',
        visibility: 'team',
      },
    }))

    expect((await GET_RUN(request('/api/u/alice/flows/runs/run-1'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(200)
    expect((await POST_CANCEL_RUN(request('/api/u/alice/flows/runs/run-1/cancel', 'POST'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(200)
  })

  it('blocks members from mutating other users shared flow runs', async () => {
    mocks.findRunByIdForScope.mockResolvedValue(createRunRecord({
      executionUserId: 'user-2',
      flow: {
        ...createFlowRecord(),
        organizationCanRun: true,
        userId: 'user-3',
        visibility: 'team',
      },
    }))

    expect((await GET_RUN(request('/api/u/alice/flows/runs/run-1'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(404)
    expect((await POST_CANCEL_RUN(request('/api/u/alice/flows/runs/run-1/cancel', 'POST'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(403)
    expect(mocks.cancelRunById).not.toHaveBeenCalled()
  })

  it('lets admins read and cancel runs in another user workspace', async () => {
    mocks.getSession.mockResolvedValue({
      sessionId: 'session-admin',
      user: { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'admin' },
    })
    mocks.findIdBySlug.mockResolvedValue({ id: 'user-1' })
    mocks.findRunByIdForScope.mockResolvedValue(createRunRecord({ executionUserId: 'user-2' }))

    expect((await GET_RUN(request('/api/u/alice/flows/runs/run-1'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(200)
    expect((await POST_CANCEL_RUN(request('/api/u/alice/flows/runs/run-1/cancel', 'POST'), params({ runId: 'run-1', slug: 'alice' }))).status)
      .toBe(200)
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
