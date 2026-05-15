import { FlowNodeType, FlowRunStatus, FlowRunStepStatus, FlowRunTrigger } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FlowDefinition } from '@/lib/flows/types'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

const mocks = vi.hoisted(() => ({
  attachRunSession: vi.fn(),
  auditCreateEvent: vi.fn(),
  claimFlowLeaseById: vi.fn(),
  claimFlowForImmediateRun: vi.fn(),
  createFlowLeaseOwner: vi.fn(),
  createInstanceClient: vi.fn(),
  createRun: vi.fn(),
  extendFlowLease: vi.fn(),
  ensureWorkspaceRunningForExecution: vi.fn(),
  findFlowByIdAndUserId: vi.fn(),
  findRunByIdAndUserId: vi.fn(),
  findRunStatusById: vi.fn(),
  markRunFailed: vi.fn(),
  markRunRunning: vi.fn(),
  markRunRetryScheduled: vi.fn(),
  markRunSucceeded: vi.fn(),
  markRunWaitingForHuman: vi.fn(),
  releaseFlowLease: vi.fn(),
  runFlowPromptAndReadOutput: vi.fn(),
  sendSlackNotifications: vi.fn(),
  touchActivity: vi.fn(),
  updateRunStepByRunIdAndNodeId: vi.fn(),
  updateRunCurrentNode: vi.fn(),
  upsertRunStep: vi.fn(),
  userFindByIdSelect: vi.fn(),
}))

vi.mock('@/lib/flows/session-executor', () => ({
  FLOW_LEASE_MS: 900_000,
  FLOW_RUN_CANCELLED_ERROR: 'flow_run_cancelled',
  createFlowLeaseOwner: mocks.createFlowLeaseOwner,
  runFlowPromptAndReadOutput: mocks.runFlowPromptAndReadOutput,
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: mocks.createInstanceClient,
}))

vi.mock('@/lib/opencode/session-execution', () => ({
  ensureWorkspaceRunningForExecution: mocks.ensureWorkspaceRunningForExecution,
}))

vi.mock('@/lib/services', () => ({
  auditService: { createEvent: mocks.auditCreateEvent },
  flowService: {
    attachRunSession: mocks.attachRunSession,
    claimFlowLeaseById: mocks.claimFlowLeaseById,
    claimFlowForImmediateRun: mocks.claimFlowForImmediateRun,
    createRun: mocks.createRun,
    extendFlowLease: mocks.extendFlowLease,
    findFlowByIdAndUserId: mocks.findFlowByIdAndUserId,
    findRunByIdAndUserId: mocks.findRunByIdAndUserId,
    findRunStatusById: mocks.findRunStatusById,
    markRunFailed: mocks.markRunFailed,
    markRunRunning: mocks.markRunRunning,
    markRunRetryScheduled: mocks.markRunRetryScheduled,
    markRunSucceeded: mocks.markRunSucceeded,
    markRunWaitingForHuman: mocks.markRunWaitingForHuman,
    releaseFlowLease: mocks.releaseFlowLease,
    updateRunStepByRunIdAndNodeId: mocks.updateRunStepByRunIdAndNodeId,
    updateRunCurrentNode: mocks.updateRunCurrentNode,
    upsertRunStep: mocks.upsertRunStep,
  },
  instanceService: { touchActivity: mocks.touchActivity },
  userService: { findByIdSelect: mocks.userFindByIdSelect },
}))

vi.mock('@/lib/slack/notifications', () => ({
  sendSlackNotifications: mocks.sendSlackNotifications,
}))

import { resumeFlowRun, runClaimedFlow, triggerFlowNow } from '@/lib/flows/runner'

const now = new Date('2026-05-12T10:00:00.000Z')

function createClaimedFlow() {
  return {
    createdAt: now,
    cronExpression: null,
    definition: createDefaultFlowDefinition(),
    description: null,
    deletedAt: null,
    enabled: false,
    id: 'flow-1',
    lastRunAt: null,
    leaseExpiresAt: new Date('2026-05-12T10:15:00.000Z'),
    leaseOwner: 'worker-1',
    name: 'Flow',
    nextRunAt: null,
    scheduledFor: now,
    timezone: 'UTC',
    updatedAt: now,
    userId: 'user-1',
  }
}

function createRunRecord(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: now,
    currentNodeId: null,
    error: null,
    finishedAt: null,
    flowId: 'flow-1',
    id: 'run-1',
    attempt: 1,
    lastRetryError: null,
    openCodeSessionId: null,
    retryScheduledFor: null,
    resultSeenAt: null,
    scheduledFor: now,
    sessionTitle: null,
    startedAt: now,
    status: FlowRunStatus.running,
    trigger: FlowRunTrigger.manual,
    updatedAt: now,
    ...overrides,
  }
}

function createStepRecord(overrides: Record<string, unknown> = {}) {
  return {
    compactedOutput: null,
    createdAt: now,
    error: null,
    finishedAt: null,
    humanResponse: null,
    id: 'step-1',
    input: null,
    nodeId: 'agent-1',
    nodeName: 'Agent',
    nodeType: FlowNodeType.agent,
    rawOutput: null,
    runId: 'run-1',
    startedAt: now,
    status: FlowRunStepStatus.running,
    updatedAt: now,
    ...overrides,
  }
}

function createWaitingRun() {
  const definition = createDefaultFlowDefinition()
  definition.nodes = [
    { id: 'human-1', instructions: 'Approve', name: 'Human', required: true, type: 'human' },
    { compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Continue', targetAgentId: null, type: 'agent' },
  ]
  definition.edges = [{ id: 'edge-1', sourceNodeId: 'human-1', targetNodeId: 'agent-1' }]
  definition.startNodeId = 'human-1'

  return {
    ...createRunRecord({ status: FlowRunStatus.waiting_for_human }),
    currentNodeId: 'human-1',
    flow: { ...createClaimedFlow(), definition },
    openCodeSessionId: 'session-1',
    sessionTitle: 'Flow | Flow',
    steps: [{
      compactedOutput: null,
      createdAt: now,
      error: null,
      finishedAt: null,
      humanResponse: null,
      id: 'step-1',
      input: { instructions: 'Approve', required: true },
      nodeId: 'human-1',
      nodeName: 'Human',
      nodeType: 'human',
      rawOutput: null,
      runId: 'run-1',
      startedAt: now,
      status: 'waiting_for_human',
      updatedAt: now,
    }],
  }
}

describe('triggerFlowNow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createFlowLeaseOwner.mockResolvedValue('worker-1')
    mocks.createRun.mockResolvedValue({
      createdAt: now,
      currentNodeId: null,
      error: null,
      finishedAt: null,
      flowId: 'flow-1',
      id: 'run-1',
      attempt: 1,
      lastRetryError: null,
      openCodeSessionId: null,
      retryScheduledFor: null,
      resultSeenAt: null,
      scheduledFor: now,
      sessionTitle: null,
      startedAt: now,
      status: FlowRunStatus.running,
      trigger: FlowRunTrigger.manual,
      updatedAt: now,
    })
    mocks.findRunByIdAndUserId.mockResolvedValue(null)
    mocks.findRunStatusById.mockResolvedValue({ status: FlowRunStatus.running })
    mocks.extendFlowLease.mockResolvedValue({ count: 1 })
    mocks.ensureWorkspaceRunningForExecution.mockResolvedValue(undefined)
    mocks.markRunFailed.mockResolvedValue({ count: 1 })
    mocks.markRunRunning.mockResolvedValue(undefined)
    mocks.markRunRetryScheduled.mockResolvedValue({ count: 1 })
    mocks.markRunSucceeded.mockResolvedValue({ count: 1 })
    mocks.markRunWaitingForHuman.mockResolvedValue(undefined)
    mocks.releaseFlowLease.mockResolvedValue({ count: 1 })
    mocks.updateRunStepByRunIdAndNodeId.mockImplementation(async (runId: string, nodeId: string, updates: Record<string, unknown>) => createStepRecord({
      ...updates,
      id: `step-${nodeId}`,
      nodeId,
      nodeName: nodeId,
      runId,
    }))
    mocks.updateRunCurrentNode.mockResolvedValue(undefined)
    mocks.upsertRunStep.mockImplementation(async (step: { nodeId: string; nodeName?: string | null; nodeType?: FlowNodeType; status: FlowRunStepStatus }) => createStepRecord({
      ...step,
      id: `step-${step.nodeId}`,
      nodeName: step.nodeName ?? step.nodeId,
      nodeType: step.nodeType ?? FlowNodeType.agent,
    }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValue({ ok: true, output: 'assistant output' })
    mocks.createInstanceClient.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'session-1' } }),
      },
    })
    mocks.auditCreateEvent.mockResolvedValue(undefined)
    mocks.touchActivity.mockResolvedValue(undefined)
    mocks.userFindByIdSelect.mockResolvedValue(null)
  })

  it('returns not_found when the requested flow does not exist', async () => {
    mocks.claimFlowForImmediateRun.mockResolvedValue(null)
    mocks.findFlowByIdAndUserId.mockResolvedValue(null)

    await expect(triggerFlowNow({ flowId: 'flow-1', trigger: FlowRunTrigger.manual, userId: 'user-1' }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    expect(mocks.createRun).not.toHaveBeenCalled()
  })

  it('returns flow_busy when the flow exists but cannot be claimed', async () => {
    mocks.claimFlowForImmediateRun.mockResolvedValue(null)
    mocks.findFlowByIdAndUserId.mockResolvedValue(createClaimedFlow())

    await expect(triggerFlowNow({ flowId: 'flow-1', trigger: FlowRunTrigger.manual, userId: 'user-1' }))
      .resolves.toEqual({ ok: false, error: 'flow_busy' })
  })

  it('creates a durable run before returning success', async () => {
    const claimedFlow = createClaimedFlow()
    mocks.claimFlowForImmediateRun.mockResolvedValue(claimedFlow)

    await expect(triggerFlowNow({ flowId: 'flow-1', trigger: FlowRunTrigger.manual, userId: 'user-1' }))
      .resolves.toEqual({ ok: true })

    expect(mocks.createRun).toHaveBeenCalledWith({
      flowId: 'flow-1',
      scheduledFor: now,
      trigger: FlowRunTrigger.manual,
    })
  })

  it('validates human resume state and dispatches valid responses', async () => {
    const waitingRun = createWaitingRun()
    mocks.findRunByIdAndUserId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createRunRecord())
      .mockResolvedValueOnce(waitingRun)
      .mockResolvedValueOnce(waitingRun)
    mocks.claimFlowLeaseById.mockResolvedValue(createClaimedFlow())
    mocks.updateRunStepByRunIdAndNodeId.mockResolvedValue(waitingRun.steps[0])

    await expect(resumeFlowRun({ humanResponse: 'Approved', runId: 'missing', userId: 'user-1' }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(resumeFlowRun({ humanResponse: 'Approved', runId: 'run-1', userId: 'user-1' }))
      .resolves.toEqual({ ok: false, error: 'invalid_state' })
    await expect(resumeFlowRun({ humanResponse: 'Approved', runId: 'run-1', userId: 'user-1' }))
      .resolves.toMatchObject({ ok: true, run: { id: 'run-1' } })

    expect(mocks.claimFlowLeaseById).toHaveBeenCalled()
    expect(mocks.markRunRunning).toHaveBeenCalledWith('run-1')
  })

  it('runs a claimed agent flow to success', async () => {
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord())
    mocks.updateRunStepByRunIdAndNodeId.mockResolvedValue({
      compactedOutput: null,
      createdAt: now,
      error: null,
      finishedAt: now,
      humanResponse: null,
      id: 'step-agent-1',
      input: null,
      nodeId: 'agent-1',
      nodeName: 'Agent',
      nodeType: 'agent',
      rawOutput: 'assistant output',
      runId: 'run-1',
      startedAt: now,
      status: 'succeeded',
      updatedAt: now,
    })

    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.manual)

    expect(mocks.ensureWorkspaceRunningForExecution).toHaveBeenCalledWith('alice', 'user-1')
    expect(mocks.markRunSucceeded).toHaveBeenCalledWith('run-1', expect.objectContaining({ openCodeSessionId: 'session-1' }))
  })

  it('runs Slack message nodes with fixed, previous output, and template messages', async () => {
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [
        { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'slack-fixed' },
        { id: 'edge-2', sourceNodeId: 'slack-fixed', targetNodeId: 'slack-previous' },
        { id: 'edge-3', sourceNodeId: 'slack-previous', targetNodeId: 'slack-template' },
      ],
      nodes: [
        { compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Start', targetAgentId: null, type: 'agent' },
        { id: 'slack-fixed', messageMode: 'fixed', messageTemplate: 'Fixed update', name: 'Fixed', target: { type: 'channel', channelId: 'C123' }, type: 'slack' },
        { id: 'slack-previous', messageMode: 'previous_output', messageTemplate: '', name: 'Previous', target: { type: 'dm', userId: 'user-1' }, type: 'slack' },
        { id: 'slack-template', messageMode: 'template', messageTemplate: 'Report: {{previous.output}} / {{steps.agent-1.output}}', name: 'Template', target: { type: 'channel', channelId: 'C456' }, type: 'slack' },
      ],
      startNodeId: 'agent-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord())
    mocks.sendSlackNotifications.mockResolvedValue({ errors: [], failed: 0, ok: true, sent: 1 })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.sendSlackNotifications).toHaveBeenNthCalledWith(1, {
      source: 'flows',
      targets: [{ type: 'channel', channelId: 'C123' }],
      text: 'Fixed update',
    })
    expect(mocks.sendSlackNotifications).toHaveBeenNthCalledWith(2, {
      source: 'flows',
      targets: [{ type: 'dm', userId: 'user-1' }],
      text: 'assistant output',
    })
    expect(mocks.sendSlackNotifications).toHaveBeenNthCalledWith(3, {
      source: 'flows',
      targets: [{ type: 'channel', channelId: 'C456' }],
      text: 'Report: assistant output / assistant output',
    })
    expect(mocks.upsertRunStep).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'slack-fixed', nodeType: FlowNodeType.slack }))
  })

  it('schedules retries for retryable startup failures across run triggers', async () => {
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.ensureWorkspaceRunningForExecution.mockRejectedValue(new Error('instance_unavailable'))
    mocks.createRun
      .mockResolvedValueOnce(createRunRecord({ id: 'run-manual', trigger: FlowRunTrigger.manual }))
      .mockResolvedValueOnce(createRunRecord({ id: 'run-schedule', trigger: FlowRunTrigger.schedule }))
      .mockResolvedValueOnce(createRunRecord({ id: 'run-on-create', trigger: FlowRunTrigger.on_create }))

    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.manual)
    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.schedule)
    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.on_create)

    expect(mocks.markRunRetryScheduled).toHaveBeenCalledTimes(3)
    expect(mocks.markRunRetryScheduled).toHaveBeenNthCalledWith(1, 'run-manual', expect.objectContaining({
      attempt: 2,
      error: 'instance_unavailable',
      retryAt: expect.any(Date),
    }))
    expect(mocks.markRunFailed).not.toHaveBeenCalledWith('run-manual', expect.any(Object))
    expect(mocks.releaseFlowLease).toHaveBeenCalledWith('flow-1', 'worker-1', undefined)
  })

  it('stops retrying after the max attempt and records the retry reason', async () => {
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.ensureWorkspaceRunningForExecution.mockRejectedValue(new Error('instance_unavailable'))
    mocks.createRun.mockResolvedValue(createRunRecord({ attempt: 5, id: 'run-exhausted' }))

    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.manual)

    expect(mocks.markRunRetryScheduled).not.toHaveBeenCalled()
    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-exhausted', expect.objectContaining({ error: 'instance_unavailable' }))
    expect(mocks.auditCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ retryReason: 'retry_exhausted', willRetry: false }),
    }))
  })

  it('stops before prompting when a run is cancelled before the next node', async () => {
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord({ id: 'run-cancelled' }))
    mocks.findRunStatusById.mockResolvedValue({ status: FlowRunStatus.cancelled })

    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.manual)

    expect(mocks.upsertRunStep).not.toHaveBeenCalled()
    expect(mocks.runFlowPromptAndReadOutput).not.toHaveBeenCalled()
    expect(mocks.markRunSucceeded).not.toHaveBeenCalledWith('run-cancelled', expect.any(Object))
    expect(mocks.markRunFailed).not.toHaveBeenCalledWith('run-cancelled', expect.any(Object))
  })

  it('does not mark the run failed when prompt execution reports cancellation', async () => {
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord({ id: 'run-cancelled-mid-prompt' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: false, error: 'flow_run_cancelled' })

    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.manual)

    expect(mocks.markRunSucceeded).not.toHaveBeenCalledWith('run-cancelled-mid-prompt', expect.any(Object))
    expect(mocks.markRunFailed).not.toHaveBeenCalledWith('run-cancelled-mid-prompt', expect.any(Object))
    expect(mocks.auditCreateEvent).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'flows.run_failed' }))
  })

  it('does not execute or finalize when the claimed flow lease is lost', async () => {
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord())
    mocks.extendFlowLease.mockResolvedValue({ count: 0 })
    mocks.releaseFlowLease.mockResolvedValue({ count: 0 })

    await runClaimedFlow(createClaimedFlow(), FlowRunTrigger.manual)

    expect(mocks.updateRunCurrentNode).not.toHaveBeenCalled()
    expect(mocks.runFlowPromptAndReadOutput).not.toHaveBeenCalled()
    expect(mocks.markRunSucceeded).not.toHaveBeenCalled()
    expect(mocks.markRunFailed).not.toHaveBeenCalled()
  })

  it('pauses a claimed human flow for input', async () => {
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [],
      nodes: [{ id: 'human-1', instructions: 'Approve', name: 'Human', required: true, type: 'human' }],
      startNodeId: 'human-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord())

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.markRunWaitingForHuman).toHaveBeenCalledWith('run-1', 'human-1')
    expect(mocks.auditCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'flows.run_waiting_for_human' }))
  })

  it('runs compacting agent, compaction, and merge nodes', async () => {
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [
        { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'compaction-1' },
        { id: 'edge-2', sourceNodeId: 'compaction-1', targetNodeId: 'merge-1' },
      ],
      nodes: [
        { compactOutput: true, id: 'agent-1', name: 'Agent', promptTemplate: 'Start {{flow.name}}', targetAgentId: 'analyst', type: 'agent' },
        { id: 'compaction-1', name: 'Compact', promptTemplate: 'Compact {{previous.output}}', type: 'compaction' },
        { id: 'merge-1', name: 'Merge', type: 'merge' },
      ],
      startNodeId: 'agent-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord())
    mocks.runFlowPromptAndReadOutput
      .mockResolvedValueOnce({ ok: true, output: 'raw agent output' })
      .mockResolvedValueOnce({ ok: true, output: 'compact agent output' })
      .mockResolvedValueOnce({ ok: true, output: 'compact node output' })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.runFlowPromptAndReadOutput).toHaveBeenCalledTimes(3)
    expect(mocks.upsertRunStep).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'compaction-1', nodeType: FlowNodeType.compaction }))
    expect(mocks.upsertRunStep).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'merge-1', nodeType: FlowNodeType.merge }))
    expect(mocks.markRunSucceeded).toHaveBeenCalledWith('run-1', expect.objectContaining({ sessionTitle: 'Flow | Flow | May 12, 2026, 10:00 AM' }))
  })

  it('runs flows with more than 100 nodes', async () => {
    const flow = createClaimedFlow()
    const nodes: FlowDefinition['nodes'] = Array.from({ length: 101 }, (_, index) => ({
      id: `merge-${index}`,
      name: `Merge ${index}`,
      type: 'merge',
    }))
    const edges: FlowDefinition['edges'] = nodes.slice(0, -1).map((node, index) => ({
      id: `edge-${index}`,
      sourceNodeId: node.id,
      targetNodeId: `merge-${index + 1}`,
    }))
    flow.definition = {
      edges,
      nodes,
      startNodeId: 'merge-0',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord())

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.upsertRunStep).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'merge-100' }))
    expect(mocks.markRunSucceeded).toHaveBeenCalledWith('run-1', expect.any(Object))
    expect(mocks.markRunFailed).not.toHaveBeenCalled()
  })

  it('evaluates condition rules before falling back to outgoing edges', async () => {
    const longMatchingPattern = `Flow|${'x'.repeat(257)}`
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [{ id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-fallback' }],
      nodes: [
        {
          id: 'condition-1',
          mode: 'rules',
          name: 'Condition',
          rules: [
            { id: 'rule-1', operator: 'contains', targetNodeId: 'merge-fallback', value: 'Other', variable: 'flow.name' },
            { id: 'rule-2', operator: 'ends_with', targetNodeId: 'merge-fallback', value: 'Other', variable: 'flow.name' },
            { id: 'rule-3', operator: 'equals', targetNodeId: 'merge-fallback', value: 'Other', variable: 'flow.name' },
            { id: 'rule-4', operator: 'equals', targetNodeId: 'merge-fallback', value: 'Flow', variable: 'missing.value' },
            { id: 'rule-5', operator: 'matches', targetNodeId: 'merge-fallback', value: 'Other.*', variable: 'flow.name' },
            { id: 'rule-6', operator: 'matches', targetNodeId: 'merge-fallback', value: '(', variable: 'flow.name' },
            { id: 'rule-7', operator: 'not_equals', targetNodeId: 'merge-fallback', value: 'Flow', variable: 'flow.name' },
            { id: 'rule-8', operator: 'starts_with', targetNodeId: 'merge-fallback', value: 'Other', variable: 'flow.name' },
            { id: 'rule-9', operator: 'exists', targetNodeId: 'merge-fallback', variable: 'missing.value' },
            { id: 'rule-10', operator: 'matches', targetNodeId: 'merge-long-regex', value: longMatchingPattern, variable: 'flow.name' },
            { id: 'rule-11', operator: 'matches', targetNodeId: 'merge-unsafe-regex', value: '(?:Flow|Other)+', variable: 'flow.name' },
            { id: 'rule-12', operator: 'not_exists', targetNodeId: 'merge-matched', variable: 'missing.value' },
          ],
          type: 'condition',
        },
        { id: 'merge-fallback', name: 'Fallback', type: 'merge' },
        { id: 'merge-long-regex', name: 'Long Regex', type: 'merge' },
        { id: 'merge-matched', name: 'Matched', type: 'merge' },
        { id: 'merge-unsafe-regex', name: 'Unsafe Regex', type: 'merge' },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValue(createRunRecord())

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.updateRunStepByRunIdAndNodeId).toHaveBeenCalledWith('run-1', 'condition-1', expect.objectContaining({ rawOutput: 'merge-matched' }))
    expect(mocks.updateRunCurrentNode).toHaveBeenCalledWith('run-1', 'merge-matched')
    expect(mocks.runFlowPromptAndReadOutput).not.toHaveBeenCalled()
  })

  it('routes AI conditions from JSON targets and fails invalid AI targets', async () => {
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [
        { id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-a' },
        { id: 'edge-2', sourceNodeId: 'condition-1', targetNodeId: 'merge-b' },
      ],
      nodes: [
        { evaluatorPrompt: 'Pick a target', id: 'condition-1', mode: 'ai', name: 'AI condition', type: 'condition' },
        { id: 'merge-a', name: 'A', type: 'merge' },
        { id: 'merge-b', name: 'B', type: 'merge' },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-ai-success' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: '{"targetNodeId":"merge-b"}' })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.updateRunCurrentNode).toHaveBeenCalledWith('run-ai-success', 'merge-b')
    expect(mocks.markRunSucceeded).toHaveBeenCalledWith('run-ai-success', expect.any(Object))

    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-ai-fail' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: 'unknown-target' })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-ai-fail', expect.objectContaining({ error: 'condition_ai_invalid_target' }))
  })

  it('truncates invalid AI condition output before persisting it', async () => {
    const flow = createClaimedFlow()
    const output = 'x'.repeat(8_012)
    flow.definition = {
      edges: [{ id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-a' }],
      nodes: [
        { evaluatorPrompt: 'Pick a target', id: 'condition-1', mode: 'ai', name: 'AI condition', type: 'condition' },
        { id: 'merge-a', name: 'A', type: 'merge' },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-ai-long-output' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.updateRunStepByRunIdAndNodeId).toHaveBeenCalledWith('run-ai-long-output', 'condition-1', expect.objectContaining({
      rawOutput: expect.stringContaining('[truncated 12 characters]'),
    }))
    expect(mocks.updateRunStepByRunIdAndNodeId).not.toHaveBeenCalledWith('run-ai-long-output', 'condition-1', expect.objectContaining({
      rawOutput: output,
    }))
  })

  it('routes AI conditions with delimited target ids and rejects ambiguous text matches', async () => {
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [
        { id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'step-1' },
        { id: 'edge-2', sourceNodeId: 'condition-1', targetNodeId: 'step-10' },
      ],
      nodes: [
        { evaluatorPrompt: 'Pick a target', id: 'condition-1', mode: 'ai', name: 'AI condition', type: 'condition' },
        { id: 'step-1', name: 'Step 1', type: 'merge' },
        { id: 'step-10', name: 'Step 10', type: 'merge' },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-ai-delimited' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: 'Choose step-10.' })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.updateRunCurrentNode).toHaveBeenCalledWith('run-ai-delimited', 'step-10')
    expect(mocks.markRunSucceeded).toHaveBeenCalledWith('run-ai-delimited', expect.any(Object))

    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-ai-ambiguous' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: 'Either step-1 or step-10 could work.' })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-ai-ambiguous', expect.objectContaining({ error: 'condition_ai_invalid_target' }))
  })

  it('fails AI conditions with no targets or failed evaluator prompts', async () => {
    const noTargetsFlow = createClaimedFlow()
    noTargetsFlow.definition = {
      edges: [],
      nodes: [{ evaluatorPrompt: 'Pick a target', id: 'condition-1', mode: 'ai', name: 'AI condition', type: 'condition' }],
      startNodeId: 'condition-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-no-targets' }))

    await runClaimedFlow(noTargetsFlow, FlowRunTrigger.manual)

    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-no-targets', expect.objectContaining({ error: 'condition_has_no_targets' }))

    const evaluatorFailFlow = createClaimedFlow()
    evaluatorFailFlow.definition = {
      edges: [{ id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-1' }],
      nodes: [
        { evaluatorPrompt: 'Pick a target', id: 'condition-1', mode: 'ai', name: 'AI condition', type: 'condition' },
        { id: 'merge-1', name: 'Merge', type: 'merge' },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-ai-error' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: false, error: 'ai_failed' })

    await runClaimedFlow(evaluatorFailFlow, FlowRunTrigger.manual)

    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-ai-error', expect.objectContaining({ error: 'ai_failed' }))
  })

  it('reports prompt and compaction execution failures', async () => {
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [],
      nodes: [{ compactOutput: true, id: 'agent-1', name: 'Agent', promptTemplate: 'Start', targetAgentId: null, type: 'agent' }],
      startNodeId: 'agent-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-prompt-fail' }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: false, error: 'prompt_failed' })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-prompt-fail', expect.objectContaining({ error: 'prompt_failed' }))

    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-compact-fail' }))
    mocks.runFlowPromptAndReadOutput
      .mockResolvedValueOnce({ ok: true, output: 'raw output' })
      .mockResolvedValueOnce({ ok: false, error: 'compact_failed' })

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-compact-fail', expect.objectContaining({ error: 'compact_failed' }))
  })

  it('marks agent steps failed when prompt execution throws', async () => {
    const flow = createClaimedFlow()
    flow.definition = {
      edges: [],
      nodes: [{ compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Start', targetAgentId: null, type: 'agent' }],
      startNodeId: 'agent-1',
      version: 1,
    }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-prompt-throw' }))
    mocks.runFlowPromptAndReadOutput.mockRejectedValueOnce(new Error('network_blip'))

    await runClaimedFlow(flow, FlowRunTrigger.manual)

    expect(mocks.updateRunStepByRunIdAndNodeId).toHaveBeenCalledWith('run-prompt-throw', 'agent-1', expect.objectContaining({
      error: 'network_blip',
      status: FlowRunStepStatus.failed,
    }))
    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-prompt-throw', expect.objectContaining({ error: 'network_blip' }))
  })

  it('rejects empty required human responses and busy resumes', async () => {
    const waitingRun = createWaitingRun()
    mocks.findRunByIdAndUserId.mockResolvedValue(waitingRun)

    await expect(resumeFlowRun({ humanResponse: '   ', runId: 'run-1', userId: 'user-1' }))
      .resolves.toEqual({ ok: false, error: 'invalid_response' })

    mocks.claimFlowLeaseById.mockResolvedValue(null)

    await expect(resumeFlowRun({ humanResponse: 'Approved', runId: 'run-1', userId: 'user-1' }))
      .resolves.toEqual({ ok: false, error: 'flow_busy' })
  })

  it('resumes a human run through the remaining agent node', async () => {
    const waitingRun = createWaitingRun()
    const refreshedRun = {
      ...waitingRun,
      status: FlowRunStatus.running,
      steps: [
        createStepRecord({
          humanResponse: 'Approved',
          nodeId: 'human-1',
          nodeName: 'Human',
          nodeType: FlowNodeType.human,
          status: FlowRunStepStatus.succeeded,
        }),
      ],
    }
    mocks.findRunByIdAndUserId
      .mockResolvedValueOnce(waitingRun)
      .mockResolvedValueOnce(refreshedRun)
      .mockResolvedValue(null)
    mocks.claimFlowLeaseById.mockResolvedValue(waitingRun.flow)
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: 'resumed output' })

    await expect(resumeFlowRun({ humanResponse: 'Approved', runId: 'run-1', userId: 'user-1' }))
      .resolves.toMatchObject({ ok: true, run: { id: 'run-1' } })

    await vi.waitFor(() => expect(mocks.markRunSucceeded).toHaveBeenCalledWith('run-1', expect.objectContaining({ openCodeSessionId: 'session-1' })))
    expect(mocks.ensureWorkspaceRunningForExecution).toHaveBeenCalledWith('alice', 'user-1')
  })

  it('marks invalid definitions failed and skips finalizing cancelled runs', async () => {
    const invalidFlow = createClaimedFlow()
    invalidFlow.definition = { edges: [], nodes: [], startNodeId: '', version: 1 }
    mocks.userFindByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-invalid' }))

    await runClaimedFlow(invalidFlow, FlowRunTrigger.manual)

    expect(mocks.markRunFailed).toHaveBeenCalledWith('run-invalid', expect.objectContaining({ error: 'invalid_definition' }))

    const cancelledFlow = createClaimedFlow()
    mocks.createRun.mockResolvedValueOnce(createRunRecord({ id: 'run-cancelled' }))
    mocks.findRunByIdAndUserId.mockResolvedValueOnce(createRunRecord({ id: 'run-cancelled', status: FlowRunStatus.cancelled }))
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: 'done' })

    await runClaimedFlow(cancelledFlow, FlowRunTrigger.manual)

    expect(mocks.markRunSucceeded).not.toHaveBeenCalledWith('run-cancelled', expect.any(Object))
  })
})
