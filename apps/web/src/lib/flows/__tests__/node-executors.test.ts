import { FlowNodeType, FlowRunStepStatus, FlowRunTrigger } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FlowConditionOperator, FlowDefinition, FlowNode } from '@/lib/flows/types'
import type { SessionExecutionClient } from '@/lib/opencode/session-execution'
import type { FlowRecord, FlowRunRecord, FlowRunStepRecord } from '@/lib/services/flow'

const mocks = vi.hoisted(() => ({
  markRunWaitingForHuman: vi.fn(),
  runFlowPromptAndReadOutput: vi.fn(),
  sendSlackNotifications: vi.fn(),
  updateRunStepByRunIdAndNodeId: vi.fn(),
  upsertRunStep: vi.fn(),
}))

vi.mock('@/lib/flows/session-executor', () => ({
  FLOW_RUN_CANCELLED_ERROR: 'flow_run_cancelled',
  runFlowPromptAndReadOutput: mocks.runFlowPromptAndReadOutput,
}))

vi.mock('@/lib/services', () => ({
  flowService: {
    markRunWaitingForHuman: mocks.markRunWaitingForHuman,
    updateRunStepByRunIdAndNodeId: mocks.updateRunStepByRunIdAndNodeId,
    upsertRunStep: mocks.upsertRunStep,
  },
}))

vi.mock('@/lib/slack/notifications', () => ({
  sendSlackNotifications: mocks.sendSlackNotifications,
}))

import { executeFlowNode } from '@/lib/flows/node-executors'

const now = new Date('2026-05-12T10:00:00.000Z')
const client = {} as SessionExecutionClient

function createFlowRecord(definition: FlowDefinition): FlowRecord {
  return {
    createdAt: now,
    cronExpression: null,
    definition,
    deletedAt: null,
    description: null,
    enabled: false,
    id: 'flow-1',
    lastRunAt: null,
    leaseExpiresAt: null,
    leaseOwner: 'worker-1',
    name: 'Flow',
    nextRunAt: null,
    timezone: 'UTC',
    updatedAt: now,
    userId: 'user-1',
  }
}

function createRunRecord(): FlowRunRecord {
  return {
    attempt: 1,
    createdAt: now,
    currentNodeId: null,
    error: null,
    finishedAt: null,
    flowId: 'flow-1',
    id: 'run-1',
    lastRetryError: null,
    openCodeSessionId: 'session-1',
    resultSeenAt: null,
    retryScheduledFor: null,
    scheduledFor: now,
    sessionTitle: 'Flow | Flow',
    startedAt: now,
    status: 'running',
    trigger: FlowRunTrigger.manual,
    updatedAt: now,
  }
}

function createStepRecord(overrides: Partial<FlowRunStepRecord> = {}): FlowRunStepRecord {
  return {
    compactedOutput: null,
    createdAt: now,
    error: null,
    finishedAt: null,
    humanResponse: null,
    id: `step-${overrides.nodeId ?? 'node-1'}`,
    input: null,
    nodeId: 'node-1',
    nodeName: 'Node',
    nodeType: FlowNodeType.merge,
    rawOutput: null,
    runId: 'run-1',
    startedAt: null,
    status: FlowRunStepStatus.running,
    updatedAt: now,
    ...overrides,
  }
}

function createDefinition(node: FlowNode, extraNodes: FlowNode[] = [], edges: FlowDefinition['edges'] = []): FlowDefinition {
  return {
    edges,
    nodes: [node, ...extraNodes],
    startNodeId: node.id,
    version: 1,
  }
}

function createParams(definition: FlowDefinition, node: FlowNode, steps: FlowRunStepRecord[] = []) {
  return {
    client,
    definition,
    flow: createFlowRecord(definition),
    leaseOwner: 'worker-1',
    node,
    previousOutput: 'previous output',
    run: createRunRecord(),
    sessionId: 'session-1',
    slug: 'alice',
    steps,
  }
}

describe('executeFlowNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsertRunStep.mockImplementation(async (step: {
      compactedOutput?: string | null
      error?: string | null
      finishedAt?: Date | null
      humanResponse?: string | null
      input?: unknown
      nodeId: string
      nodeName?: string | null
      nodeType: FlowNodeType
      rawOutput?: string | null
      runId: string
      startedAt?: Date | null
      status: FlowRunStepStatus
    }) => createStepRecord({
      compactedOutput: step.compactedOutput ?? null,
      error: step.error ?? null,
      finishedAt: step.finishedAt ?? null,
      humanResponse: step.humanResponse ?? null,
      input: step.input ?? null,
      nodeId: step.nodeId,
      nodeName: step.nodeName ?? null,
      nodeType: step.nodeType,
      rawOutput: step.rawOutput ?? null,
      runId: step.runId,
      startedAt: step.startedAt ?? null,
      status: step.status,
    }))
    mocks.updateRunStepByRunIdAndNodeId.mockImplementation(async (runId: string, nodeId: string, updates: Partial<FlowRunStepRecord>) => createStepRecord({
      ...updates,
      nodeId,
      runId,
      status: updates.status ?? FlowRunStepStatus.succeeded,
    }))
    mocks.markRunWaitingForHuman.mockResolvedValue(undefined)
    mocks.runFlowPromptAndReadOutput.mockResolvedValue({ ok: true, output: 'assistant output' })
    mocks.sendSlackNotifications.mockResolvedValue({ errors: [], failed: 0, ok: true, sent: 1 })
  })

  it('executes compacting agent nodes and advances to the outgoing edge', async () => {
    const node: FlowNode = { compactOutput: true, id: 'agent-1', name: 'Agent', promptTemplate: 'Use {{previous.output}}', targetAgentId: 'writer', type: 'agent' }
    const merge: FlowNode = { id: 'merge-1', name: 'Merge', type: 'merge' }
    const definition = createDefinition(node, [merge], [{ id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'merge-1' }])
    mocks.runFlowPromptAndReadOutput
      .mockResolvedValueOnce({ ok: true, output: 'raw output' })
      .mockResolvedValueOnce({ ok: true, output: 'compact output' })

    const result = await executeFlowNode(createParams(definition, node))

    expect(result).toMatchObject({ nextNodeId: 'merge-1', previousOutput: 'compact output', status: 'continue' })
    expect(mocks.runFlowPromptAndReadOutput).toHaveBeenNthCalledWith(1, expect.objectContaining({ agent: 'writer', prompt: 'Use previous output' }))
    expect(mocks.updateRunStepByRunIdAndNodeId).toHaveBeenCalledWith('run-1', 'agent-1', expect.objectContaining({ compactedOutput: 'compact output', rawOutput: 'raw output' }))
  })

  it('marks agent nodes failed when prompt execution throws', async () => {
    const node: FlowNode = { compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Start', targetAgentId: null, type: 'agent' }
    const definition = createDefinition(node)
    mocks.runFlowPromptAndReadOutput.mockRejectedValueOnce(new Error('network_blip'))

    const result = await executeFlowNode(createParams(definition, node))

    expect(result).toMatchObject({ error: 'network_blip', status: 'failed' })
    expect(mocks.updateRunStepByRunIdAndNodeId).toHaveBeenCalledWith('run-1', 'agent-1', expect.objectContaining({ error: 'network_blip', status: FlowRunStepStatus.failed }))
  })

  it('uses graph edges as the authoritative condition rule targets', async () => {
    const node: FlowNode = {
      id: 'condition-1',
      mode: 'rules',
      name: 'Condition',
      rules: [
        { id: 'rule-1', operator: 'equals', targetNodeId: 'merge-disconnected', value: 'Flow', variable: 'flow.name' },
      ],
      type: 'condition',
    }
    const fallback: FlowNode = { id: 'merge-fallback', name: 'Fallback', type: 'merge' }
    const disconnected: FlowNode = { id: 'merge-disconnected', name: 'Disconnected', type: 'merge' }
    const definition = createDefinition(node, [fallback, disconnected], [{ id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-fallback' }])

    const result = await executeFlowNode(createParams(definition, node))

    expect(result).toMatchObject({ nextNodeId: 'merge-fallback', previousOutput: 'merge-fallback', status: 'continue' })
    expect(mocks.updateRunStepByRunIdAndNodeId).toHaveBeenCalledWith('run-1', 'condition-1', expect.objectContaining({ rawOutput: 'merge-fallback' }))
  })

  it('executes AI condition nodes and reports invalid target output', async () => {
    const node: FlowNode = { evaluatorPrompt: 'Pick {{previous.output}}', id: 'condition-1', mode: 'ai', name: 'Condition', type: 'condition' }
    const target: FlowNode = { id: 'merge-1', name: 'Merge', type: 'merge' }
    const definition = createDefinition(node, [target], [{ id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-1' }])
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: '{"targetNodeId":"merge-1"}' })

    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ nextNodeId: 'merge-1', status: 'continue' })

    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: 'x'.repeat(8_012) })

    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ error: 'condition_ai_invalid_target', status: 'failed' })
    expect(mocks.updateRunStepByRunIdAndNodeId).toHaveBeenCalledWith('run-1', 'condition-1', expect.objectContaining({ rawOutput: expect.stringContaining('[truncated 12 characters]') }))
  })

  it('pauses human nodes with rendered instructions', async () => {
    const node: FlowNode = { id: 'human-1', instructions: 'Review {{previous.output}}', name: 'Human', required: true, type: 'human' }
    const definition = createDefinition(node)

    const result = await executeFlowNode(createParams(definition, node))

    expect(result).toMatchObject({ nodeId: 'human-1', status: 'waiting_for_human' })
    expect(mocks.upsertRunStep).toHaveBeenCalledWith(expect.objectContaining({ input: { instructions: 'Review previous output', required: true }, status: FlowRunStepStatus.waiting_for_human }))
    expect(mocks.markRunWaitingForHuman).toHaveBeenCalledWith('run-1', 'human-1')
  })

  it('handles Slack success, missing previous output, and delivery failures', async () => {
    const node: FlowNode = { id: 'slack-1', messageMode: 'template', messageTemplate: 'Report {{previous.output}}', name: 'Slack', target: { type: 'channel', channelId: 'C1' }, type: 'slack' }
    const definition = createDefinition(node)

    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ previousOutput: 'previous output', status: 'continue' })
    expect(mocks.sendSlackNotifications).toHaveBeenCalledWith({ source: 'flows', targets: [{ type: 'channel', channelId: 'C1' }], text: 'Report previous output' })

    const previousNode: FlowNode = { ...node, messageMode: 'previous_output', messageTemplate: '' }
    await expect(executeFlowNode({ ...createParams(createDefinition(previousNode), previousNode), previousOutput: null })).resolves.toMatchObject({ error: 'slack_message_previous_output_missing', status: 'failed' })

    mocks.sendSlackNotifications.mockResolvedValueOnce({ errors: [{ error: 'not_in_channel' }], failed: 1, ok: true, sent: 0 })
    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ error: 'not_in_channel', status: 'failed' })
  })

  it('handles compaction cancellation and merge pass-through nodes', async () => {
    const compaction: FlowNode = { id: 'compaction-1', name: 'Compact', promptTemplate: 'Compact {{previous.output}}', type: 'compaction' }
    const merge: FlowNode = { id: 'merge-1', name: 'Merge', type: 'merge' }
    const definition = createDefinition(compaction, [merge], [{ id: 'edge-1', sourceNodeId: 'compaction-1', targetNodeId: 'merge-1' }])
    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: false, error: 'flow_run_cancelled' })

    await expect(executeFlowNode(createParams(definition, compaction))).resolves.toMatchObject({ status: 'cancelled' })
    await expect(executeFlowNode(createParams(createDefinition(merge), merge))).resolves.toMatchObject({ nextNodeId: null, previousOutput: 'previous output', status: 'continue' })
  })

  it('evaluates each positive condition rule operator', async () => {
    const cases = [
      { operator: 'contains', value: 'output' },
      { operator: 'ends_with', value: 'output' },
      { operator: 'equals', value: 'previous output' },
      { operator: 'matches', value: '^previous [a-z]+$' },
      { operator: 'not_equals', value: 'other' },
      { operator: 'starts_with', value: 'previous' },
      { operator: 'exists' },
    ] satisfies Array<{ operator: FlowConditionOperator; value?: string }>

    for (const ruleCase of cases) {
      const node: FlowNode = {
        id: `condition-${ruleCase.operator}`,
        mode: 'rules',
        name: 'Condition',
        rules: [{ id: 'rule-1', operator: ruleCase.operator, targetNodeId: 'merge-1', value: ruleCase.value, variable: 'previous.output' }],
        type: 'condition',
      }
      const target: FlowNode = { id: 'merge-1', name: 'Merge', type: 'merge' }
      const definition = createDefinition(node, [target], [{ id: 'edge-1', sourceNodeId: node.id, targetNodeId: 'merge-1' }])

      await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ nextNodeId: 'merge-1', status: 'continue' })
    }
  })

  it('ignores unsafe condition regex rules and falls back to the first edge', async () => {
    const node: FlowNode = {
      id: 'condition-1',
      mode: 'rules',
      name: 'Condition',
      rules: [
        { id: 'rule-1', operator: 'matches', targetNodeId: 'merge-backref', value: '\\1', variable: 'flow.name' },
        { id: 'rule-2', operator: 'matches', targetNodeId: 'merge-lookahead', value: '(?=Flow)', variable: 'flow.name' },
        { id: 'rule-3', operator: 'matches', targetNodeId: 'merge-alternation', value: '(Flow|Other)+', variable: 'flow.name' },
      ],
      type: 'condition',
    }
    const fallback: FlowNode = { id: 'merge-fallback', name: 'Fallback', type: 'merge' }
    const backref: FlowNode = { id: 'merge-backref', name: 'Backref', type: 'merge' }
    const lookahead: FlowNode = { id: 'merge-lookahead', name: 'Lookahead', type: 'merge' }
    const alternation: FlowNode = { id: 'merge-alternation', name: 'Alternation', type: 'merge' }
    const definition = createDefinition(node, [fallback, backref, lookahead, alternation], [
      { id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-fallback' },
      { id: 'edge-2', sourceNodeId: 'condition-1', targetNodeId: 'merge-backref' },
      { id: 'edge-3', sourceNodeId: 'condition-1', targetNodeId: 'merge-lookahead' },
      { id: 'edge-4', sourceNodeId: 'condition-1', targetNodeId: 'merge-alternation' },
    ])

    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ nextNodeId: 'merge-fallback', status: 'continue' })
  })

  it('handles AI condition render, execution, cancellation, and exact-target paths', async () => {
    const target: FlowNode = { id: 'merge-1', name: 'Merge', type: 'merge' }
    const node: FlowNode = { evaluatorPrompt: 'Pick {{previous.output}}', id: 'condition-1', mode: 'ai', name: 'Condition', type: 'condition' }
    const definition = createDefinition(node, [target], [{ id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'merge-1' }])

    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: true, output: 'merge-1' })
    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ nextNodeId: 'merge-1', status: 'continue' })

    const invalidTemplateNode: FlowNode = { ...node, evaluatorPrompt: 'Pick {{missing.value}}' }
    await expect(executeFlowNode(createParams(createDefinition(invalidTemplateNode, [target], definition.edges), invalidTemplateNode))).resolves.toMatchObject({ error: 'unknown_template_variable:missing.value', status: 'failed' })

    mocks.runFlowPromptAndReadOutput.mockRejectedValueOnce(new Error('ai_down'))
    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ error: 'ai_down', status: 'failed' })

    mocks.runFlowPromptAndReadOutput.mockResolvedValueOnce({ ok: false, error: 'flow_run_cancelled' })
    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('handles Slack notification send errors', async () => {
    const node: FlowNode = { id: 'slack-1', messageMode: 'fixed', messageTemplate: 'Fixed update', name: 'Slack', target: { type: 'channel', channelId: 'C1' }, type: 'slack' }
    const definition = createDefinition(node)

    mocks.sendSlackNotifications.mockRejectedValueOnce(new Error('slack_down'))
    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ error: 'slack_down', status: 'failed' })

    mocks.sendSlackNotifications.mockResolvedValueOnce({ error: 'slack_api_down', ok: false })
    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ error: 'slack_api_down', status: 'failed' })

    mocks.sendSlackNotifications.mockResolvedValueOnce({ errors: [], failed: 1, ok: true, sent: 0 })
    await expect(executeFlowNode(createParams(definition, node))).resolves.toMatchObject({ error: 'slack_notification_failed', status: 'failed' })
  })

  it('fails nodes with invalid templates and compaction execution errors', async () => {
    const human: FlowNode = { id: 'human-1', instructions: 'Review {{missing.value}}', name: 'Human', required: true, type: 'human' }
    await expect(executeFlowNode(createParams(createDefinition(human), human))).resolves.toMatchObject({ error: 'unknown_template_variable:missing.value', status: 'failed' })

    const compaction: FlowNode = { id: 'compaction-1', name: 'Compact', promptTemplate: 'Compact {{missing.value}}', type: 'compaction' }
    await expect(executeFlowNode(createParams(createDefinition(compaction), compaction))).resolves.toMatchObject({ error: 'unknown_template_variable:missing.value', status: 'failed' })

    const validCompaction: FlowNode = { id: 'compaction-1', name: 'Compact', promptTemplate: 'Compact {{previous.output}}', type: 'compaction' }
    mocks.runFlowPromptAndReadOutput.mockRejectedValueOnce(new Error('compact_down'))
    await expect(executeFlowNode(createParams(createDefinition(validCompaction), validCompaction))).resolves.toMatchObject({ error: 'compact_down', status: 'failed' })

    const compactingAgent: FlowNode = { compactOutput: true, id: 'agent-1', name: 'Agent', promptTemplate: 'Start', targetAgentId: null, type: 'agent' }
    mocks.runFlowPromptAndReadOutput
      .mockResolvedValueOnce({ ok: true, output: 'raw output' })
      .mockRejectedValueOnce(new Error('agent_compact_down'))
    await expect(executeFlowNode(createParams(createDefinition(compactingAgent), compactingAgent))).resolves.toMatchObject({ error: 'agent_compact_down', status: 'failed' })
  })
})
