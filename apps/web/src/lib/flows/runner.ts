import {
  FlowNodeType as PrismaFlowNodeType,
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTrigger,
} from '@prisma/client'

import { formatFlowRunDate } from '@/lib/flows/cron'
import { serializeFlowRun, toPrismaJson } from '@/lib/flows/serializers'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { ConditionFlowNode, FlowConditionOperator, FlowDefinition, FlowNode } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
  type SessionExecutionClient,
} from '@/lib/opencode/session-execution'
import { isRecord } from '@/lib/records'
import { auditService, flowService, instanceService, userService } from '@/lib/services'
import type { FlowClaimedRecord, FlowRecord, FlowRunDetailRecord, FlowRunRecord, FlowRunStepRecord } from '@/lib/services/flow'

const LEASE_EXTENSION_INTERVAL_MS = 60_000
export const FLOW_LEASE_MS = 15 * 60 * 1000

type FlowExecutionOutcome =
  | { status: 'succeeded' }
  | { status: 'waiting_for_human'; nodeId: string }
  | { status: 'failed'; error: string }

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

async function createLeaseOwner(): Promise<string> {
  const { randomUUID } = await importRuntimeModule<typeof import('crypto')>('crypto')
  return `flows:${process.pid}:${randomUUID()}`
}

function buildFlowSessionTitle(flow: FlowRecord, scheduledFor: Date): string {
  return `Flow | ${flow.name} | ${formatFlowRunDate(scheduledFor, flow.timezone)}`
}

function nodeTypeToPrisma(node: FlowNode): PrismaFlowNodeType {
  switch (node.type) {
    case 'agent':
      return PrismaFlowNodeType.agent
    case 'human':
      return PrismaFlowNodeType.human
    case 'condition':
      return PrismaFlowNodeType.condition
    case 'merge':
      return PrismaFlowNodeType.merge
    case 'compaction':
      return PrismaFlowNodeType.compaction
  }
}

function getNodeById(definition: FlowDefinition, nodeId: string): FlowNode | null {
  return definition.nodes.find((node) => node.id === nodeId) ?? null
}

function getOutgoingTargets(definition: FlowDefinition, nodeId: string): string[] {
  return definition.edges
    .filter((edge) => edge.sourceNodeId === nodeId)
    .map((edge) => edge.targetNodeId)
}

function replaceStep(steps: FlowRunStepRecord[], step: FlowRunStepRecord): FlowRunStepRecord[] {
  const existingIndex = steps.findIndex((candidate) => candidate.nodeId === step.nodeId)
  if (existingIndex === -1) return [...steps, step]

  const next = [...steps]
  next[existingIndex] = step
  return next
}

function evaluateRule(value: string | null, operator: FlowConditionOperator, expected?: string): boolean {
  if (operator === 'exists') return Boolean(value && value.length > 0)
  if (operator === 'not_exists') return !value || value.length === 0
  if (value === null) return false

  const right = expected ?? ''
  switch (operator) {
    case 'contains':
      return value.includes(right)
    case 'ends_with':
      return value.endsWith(right)
    case 'equals':
      return value === right
    case 'matches':
      try {
        return new RegExp(right).test(value)
      } catch {
        return false
      }
    case 'not_equals':
      return value !== right
    case 'starts_with':
      return value.startsWith(right)
  }
}

function extractAiTarget(rawOutput: string, targetNodeIds: string[]): string | null {
  const trimmed = rawOutput.trim()
  if (targetNodeIds.includes(trimmed)) return trimmed

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isRecord(parsed) && typeof parsed.targetNodeId === 'string' && targetNodeIds.includes(parsed.targetNodeId)) {
      return parsed.targetNodeId
    }
  } catch {
    // Fall through to text matching.
  }

  return targetNodeIds.find((targetNodeId) => trimmed.includes(targetNodeId)) ?? null
}

async function runPromptAndReadOutput(params: {
  agent?: string | null
  client: SessionExecutionClient
  flowId: string
  leaseOwner: string
  prompt: string
  sessionId: string
  slug: string
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const cursor = await captureSessionMessageCursor(params.client, params.sessionId)
  await params.client.session.promptAsync(
    {
      agent: params.agent ?? undefined,
      parts: [{ text: params.prompt, type: 'text' }],
      sessionID: params.sessionId,
    },
    { throwOnError: true },
  )

  let lastLeaseExtensionAt = 0
  const failure = await waitForSessionToComplete({
    client: params.client,
    cursor,
    onPulse: async () => {
      if (Date.now() - lastLeaseExtensionAt < LEASE_EXTENSION_INTERVAL_MS) {
        return
      }

      await flowService.extendFlowLease(
        params.flowId,
        params.leaseOwner,
        new Date(Date.now() + FLOW_LEASE_MS),
      )
      lastLeaseExtensionAt = Date.now()
    },
    sessionId: params.sessionId,
    slug: params.slug,
  })

  if (failure) {
    return { ok: false, error: failure }
  }

  const output = await readLatestAssistantText(params.client, params.sessionId, cursor)
  if (!output) {
    return { ok: false, error: 'flow_no_assistant_output' }
  }

  return { ok: true, output }
}

async function executeAgentNode(params: {
  client: SessionExecutionClient
  flow: FlowRecord
  leaseOwner: string
  node: Extract<FlowNode, { type: 'agent' }>
  previousOutput: string | null
  run: FlowRunRecord
  sessionId: string
  slug: string
  steps: FlowRunStepRecord[]
}): Promise<
  | { ok: true; previousOutput: string; steps: FlowRunStepRecord[] }
  | { ok: false; error: string; steps: FlowRunStepRecord[] }
> {
  const context = buildFlowTemplateContext({
    flowName: params.flow.name,
    previousOutput: params.previousOutput,
    runId: params.run.id,
    steps: params.steps,
  })
  const rendered = renderFlowTemplate(params.node.promptTemplate, context)
  if (!rendered.ok) return { ok: false, error: rendered.error, steps: params.steps }

  let steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ prompt: rendered.value }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.running,
  }))

  const rawResult = await runPromptAndReadOutput({
    agent: params.node.targetAgentId,
    client: params.client,
    flowId: params.flow.id,
    leaseOwner: params.leaseOwner,
    prompt: rendered.value,
    sessionId: params.sessionId,
    slug: params.slug,
  })
  if (!rawResult.ok) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: rawResult.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: rawResult.error, steps }
  }

  let compactedOutput: string | null = null
  if (params.node.compactOutput) {
    const compactPrompt = [
      'Compact the previous assistant output for use by later flow steps.',
      'Keep the facts, decisions, links, and next actions. Return only the compacted output.',
      '',
      rawResult.output,
    ].join('\n')
    const compactResult = await runPromptAndReadOutput({
      client: params.client,
      flowId: params.flow.id,
      leaseOwner: params.leaseOwner,
      prompt: compactPrompt,
      sessionId: params.sessionId,
      slug: params.slug,
    })
    if (!compactResult.ok) {
      steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
        error: compactResult.error,
        finishedAt: new Date(),
        rawOutput: rawResult.output,
        status: FlowRunStepStatus.failed,
      }))
      return { ok: false, error: compactResult.error, steps }
    }

    compactedOutput = compactResult.output
  }

  const output = compactedOutput ?? rawResult.output
  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    compactedOutput,
    finishedAt: new Date(),
    rawOutput: rawResult.output,
    status: FlowRunStepStatus.succeeded,
  }))

  return { ok: true, previousOutput: output, steps }
}

function resolveRuleVariable(params: {
  flow: FlowRecord
  previousOutput: string | null
  run: FlowRunRecord
  steps: FlowRunStepRecord[]
  variable: string
}): string | null {
  const template = `{{${params.variable}}}`
  const rendered = renderFlowTemplate(template, buildFlowTemplateContext({
    flowName: params.flow.name,
    previousOutput: params.previousOutput,
    runId: params.run.id,
    steps: params.steps,
  }))

  return rendered.ok ? rendered.value : null
}

async function executeConditionNode(params: {
  client: SessionExecutionClient
  definition: FlowDefinition
  flow: FlowRecord
  leaseOwner: string
  node: ConditionFlowNode
  previousOutput: string | null
  run: FlowRunRecord
  sessionId: string
  slug: string
  steps: FlowRunStepRecord[]
}): Promise<
  | { ok: true; nextNodeId: string | null; previousOutput: string | null; steps: FlowRunStepRecord[] }
  | { ok: false; error: string; steps: FlowRunStepRecord[] }
> {
  let steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ mode: params.node.mode }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.running,
  }))
  const outgoingTargets = getOutgoingTargets(params.definition, params.node.id)

  if (params.node.mode === 'rules') {
    const matchedRule = (params.node.rules ?? []).find((rule) => {
      const value = resolveRuleVariable({
        flow: params.flow,
        previousOutput: params.previousOutput,
        run: params.run,
        steps,
        variable: rule.variable,
      })
      return evaluateRule(value, rule.operator, rule.value)
    })
    const nextNodeId = matchedRule?.targetNodeId ?? outgoingTargets[0] ?? null
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      finishedAt: new Date(),
      rawOutput: nextNodeId,
      status: FlowRunStepStatus.succeeded,
    }))
    return { ok: true, nextNodeId, previousOutput: nextNodeId, steps }
  }

  if (outgoingTargets.length === 0) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: 'condition_has_no_targets',
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: 'condition_has_no_targets', steps }
  }

  const context = buildFlowTemplateContext({
    flowName: params.flow.name,
    previousOutput: params.previousOutput,
    runId: params.run.id,
    steps,
  })
  const rendered = renderFlowTemplate(params.node.evaluatorPrompt ?? '', context)
  if (!rendered.ok) return { ok: false, error: rendered.error, steps }

  const prompt = [
    rendered.value,
    '',
    'Choose exactly one target node id from this list and return only that id or JSON like {"targetNodeId":"..."}.',
    outgoingTargets.map((targetNodeId) => `- ${targetNodeId}`).join('\n'),
  ].join('\n')
  const aiResult = await runPromptAndReadOutput({
    client: params.client,
    flowId: params.flow.id,
    leaseOwner: params.leaseOwner,
    prompt,
    sessionId: params.sessionId,
    slug: params.slug,
  })
  if (!aiResult.ok) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: aiResult.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: aiResult.error, steps }
  }

  const nextNodeId = extractAiTarget(aiResult.output, outgoingTargets)
  if (!nextNodeId) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: 'condition_ai_invalid_target',
      finishedAt: new Date(),
      rawOutput: aiResult.output,
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: 'condition_ai_invalid_target', steps }
  }

  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    finishedAt: new Date(),
    rawOutput: aiResult.output,
    status: FlowRunStepStatus.succeeded,
  }))
  return { ok: true, nextNodeId, previousOutput: nextNodeId, steps }
}

async function executeFlowNodes(params: {
  client: SessionExecutionClient
  definition: FlowDefinition
  flow: FlowRecord
  leaseOwner: string
  previousOutput: string | null
  run: FlowRunRecord
  sessionId: string
  slug: string
  startNodeId: string | null
  steps: FlowRunStepRecord[]
}): Promise<FlowExecutionOutcome> {
  let currentNodeId = params.startNodeId
  let previousOutput = params.previousOutput
  let steps = params.steps

  while (currentNodeId) {
    const node = getNodeById(params.definition, currentNodeId)
    if (!node) {
      return { status: 'failed', error: 'flow_node_not_found' }
    }

    await flowService.updateRunCurrentNode(params.run.id, node.id)

    if (node.type === 'agent') {
      const result = await executeAgentNode({
        client: params.client,
        flow: params.flow,
        leaseOwner: params.leaseOwner,
        node,
        previousOutput,
        run: params.run,
        sessionId: params.sessionId,
        slug: params.slug,
        steps,
      })
      steps = result.steps
      if (!result.ok) return { status: 'failed', error: result.error }
      previousOutput = result.previousOutput
      currentNodeId = getOutgoingTargets(params.definition, node.id)[0] ?? null
      continue
    }

    if (node.type === 'human') {
      await flowService.upsertRunStep({
        input: toPrismaJson({ instructions: node.instructions, required: node.required }),
        nodeId: node.id,
        nodeName: node.name,
        nodeType: nodeTypeToPrisma(node),
        runId: params.run.id,
        startedAt: new Date(),
        status: FlowRunStepStatus.waiting_for_human,
      })
      await flowService.markRunWaitingForHuman(params.run.id, node.id)
      return { nodeId: node.id, status: 'waiting_for_human' }
    }

    if (node.type === 'condition') {
      const result = await executeConditionNode({
        client: params.client,
        definition: params.definition,
        flow: params.flow,
        leaseOwner: params.leaseOwner,
        node,
        previousOutput,
        run: params.run,
        sessionId: params.sessionId,
        slug: params.slug,
        steps,
      })
      steps = result.steps
      if (!result.ok) return { status: 'failed', error: result.error }
      previousOutput = result.previousOutput
      currentNodeId = result.nextNodeId
      continue
    }

    if (node.type === 'compaction') {
      const context = buildFlowTemplateContext({
        flowName: params.flow.name,
        previousOutput,
        runId: params.run.id,
        steps,
      })
      const rendered = renderFlowTemplate(node.promptTemplate, context)
      if (!rendered.ok) return { status: 'failed', error: rendered.error }
      const result = await runPromptAndReadOutput({
        client: params.client,
        flowId: params.flow.id,
        leaseOwner: params.leaseOwner,
        prompt: rendered.value,
        sessionId: params.sessionId,
        slug: params.slug,
      })
      if (!result.ok) return { status: 'failed', error: result.error }
      steps = replaceStep(steps, await flowService.upsertRunStep({
        compactedOutput: result.output,
        finishedAt: new Date(),
        input: toPrismaJson({ prompt: rendered.value }),
        nodeId: node.id,
        nodeName: node.name,
        nodeType: nodeTypeToPrisma(node),
        rawOutput: result.output,
        runId: params.run.id,
        startedAt: new Date(),
        status: FlowRunStepStatus.succeeded,
      }))
      previousOutput = result.output
      currentNodeId = getOutgoingTargets(params.definition, node.id)[0] ?? null
      continue
    }

    await flowService.upsertRunStep({
      finishedAt: new Date(),
      nodeId: node.id,
      nodeName: node.name,
      nodeType: nodeTypeToPrisma(node),
      runId: params.run.id,
      startedAt: new Date(),
      status: FlowRunStepStatus.succeeded,
    })
    currentNodeId = getOutgoingTargets(params.definition, node.id)[0] ?? null
  }

  return { status: 'succeeded' }
}

async function continueRun(params: {
  client: SessionExecutionClient
  flow: FlowRecord
  leaseOwner: string
  previousOutput: string | null
  run: FlowRunRecord & { steps?: FlowRunStepRecord[] }
  sessionId: string
  slug: string
  startNodeId: string | null
}): Promise<FlowExecutionOutcome> {
  const definitionResult = validateFlowDefinition(params.flow.definition)
  if (!definitionResult.ok) {
    return { status: 'failed', error: definitionResult.error }
  }

  return executeFlowNodes({
    client: params.client,
    definition: definitionResult.definition,
    flow: params.flow,
    leaseOwner: params.leaseOwner,
    previousOutput: params.previousOutput,
    run: params.run,
    sessionId: params.sessionId,
    slug: params.slug,
    startNodeId: params.startNodeId,
    steps: params.run.steps ?? [],
  })
}

async function finalizeRun(params: {
  flow: FlowRecord
  outcome: FlowExecutionOutcome
  run: FlowRunRecord
  sessionId: string | null
  sessionTitle: string | null
  slug: string
  trigger: FlowRunTrigger
}) {
  if (params.outcome.status === 'waiting_for_human') {
    await auditService.createEvent({
      action: 'flows.run_waiting_for_human',
      actorUserId: params.flow.userId,
      metadata: {
        flowId: params.flow.id,
        nodeId: params.outcome.nodeId,
        runId: params.run.id,
        sessionId: params.sessionId,
        slug: params.slug,
        trigger: params.trigger,
      },
    })
    return
  }

  const finishedAt = new Date()
  const currentRun = await flowService.findRunByIdAndUserId(params.run.id, params.flow.userId)
  if (currentRun?.status === FlowRunStatus.cancelled) {
    return
  }

  if (params.outcome.status === 'succeeded') {
    await flowService.markRunSucceeded(params.run.id, {
      finishedAt,
      openCodeSessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
    })
    await auditService.createEvent({
      action: 'flows.run_succeeded',
      actorUserId: params.flow.userId,
      metadata: {
        flowId: params.flow.id,
        runId: params.run.id,
        sessionId: params.sessionId,
        slug: params.slug,
        trigger: params.trigger,
      },
    })
    return
  }

  await flowService.markRunFailed(params.run.id, {
    error: params.outcome.error,
    finishedAt,
    openCodeSessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
  })
  await auditService.createEvent({
    action: 'flows.run_failed',
    actorUserId: params.flow.userId,
    metadata: {
      error: params.outcome.error,
      flowId: params.flow.id,
      runId: params.run.id,
      sessionId: params.sessionId,
      slug: params.slug,
      trigger: params.trigger,
    },
  })
}

export async function runClaimedFlow(
  flow: FlowClaimedRecord,
  trigger: FlowRunTrigger,
): Promise<void> {
  const run = await flowService.createRun({
    flowId: flow.id,
    scheduledFor: flow.scheduledFor,
    trigger,
  })

  let sessionId: string | null = null
  let sessionTitle: string | null = null
  let slug: string | null = null
  let outcome: FlowExecutionOutcome = { status: 'failed', error: 'flow_run_failed' }

  try {
    const owner = await userService.findByIdSelect(flow.userId, { slug: true })
    if (!owner) throw new Error('flow_user_not_found')

    slug = owner.slug
    await ensureWorkspaceRunningForExecution(slug, flow.userId)
    await instanceService.touchActivity(slug).catch(() => undefined)

    const client = await createInstanceClient(slug)
    if (!client) throw new Error('instance_unavailable')

    sessionTitle = buildFlowSessionTitle(flow, flow.scheduledFor)
    const sessionResult = await client.session.create({ title: sessionTitle }, { throwOnError: true })
    if (!sessionResult.data) throw new Error('flow_session_create_failed')

    sessionId = sessionResult.data.id
    await flowService.attachRunSession(run.id, { openCodeSessionId: sessionId, sessionTitle })
    const definitionResult = validateFlowDefinition(flow.definition)
    outcome = await continueRun({
      client,
      flow,
      leaseOwner: flow.leaseOwner ?? '',
      previousOutput: null,
      run,
      sessionId,
      slug,
      startNodeId: definitionResult.ok ? definitionResult.definition.startNodeId : null,
    })
  } catch (error) {
    outcome = { status: 'failed', error: error instanceof Error ? error.message : 'flow_run_failed' }
  } finally {
    await finalizeRun({
      flow,
      outcome,
      run,
      sessionId,
      sessionTitle,
      slug: slug ?? '',
      trigger,
    }).catch(() => undefined)

    await flowService.releaseFlowLease(
      flow.id,
      flow.leaseOwner ?? '',
      outcome.status === 'waiting_for_human' ? undefined : new Date(),
    ).catch(() => undefined)
  }
}

export async function triggerFlowNow(params: {
  flowId: string
  trigger: FlowRunTrigger
  userId?: string
}): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'flow_busy' }> {
  const now = new Date()
  const leaseOwner = await createLeaseOwner()
  const claimed = await flowService.claimFlowForImmediateRun({
    id: params.flowId,
    leaseMs: FLOW_LEASE_MS,
    leaseOwner,
    now,
    userId: params.userId,
  })

  if (!claimed) {
    const flow = params.userId
      ? await flowService.findFlowByIdAndUserId(params.flowId, params.userId)
      : null
    if (!flow && params.userId) return { ok: false, error: 'not_found' }
    return { ok: false, error: 'flow_busy' }
  }

  void runClaimedFlow(claimed, params.trigger).catch((error) => {
    console.error('[flows] Failed to execute immediate flow run', {
      error,
      flowId: claimed.id,
      trigger: params.trigger,
    })
  })

  return { ok: true }
}

export async function resumeFlowRun(params: {
  humanResponse: string
  runId: string
  userId: string
}): Promise<{ ok: true; run: ReturnType<typeof serializeFlowRun> } | { ok: false; error: 'invalid_response' | 'invalid_state' | 'not_found' | 'flow_busy' }> {
  const run = await flowService.findRunByIdAndUserId(params.runId, params.userId)
  if (!run) return { ok: false, error: 'not_found' }
  if (run.status !== FlowRunStatus.waiting_for_human || !run.currentNodeId || !run.openCodeSessionId) {
    return { ok: false, error: 'invalid_state' }
  }

  const definitionResult = validateFlowDefinition(run.flow.definition)
  if (!definitionResult.ok) return { ok: false, error: 'invalid_state' }

  const humanNode = getNodeById(definitionResult.definition, run.currentNodeId)
  if (!humanNode || humanNode.type !== 'human') return { ok: false, error: 'invalid_state' }

  const response = params.humanResponse.trim()
  if (humanNode.required && !response) return { ok: false, error: 'invalid_response' }

  const leaseOwner = await createLeaseOwner()
  const claimedFlow = await flowService.claimFlowLeaseById({
    id: run.flowId,
    leaseMs: FLOW_LEASE_MS,
    leaseOwner,
    now: new Date(),
    userId: params.userId,
  })
  if (!claimedFlow) return { ok: false, error: 'flow_busy' }

  await flowService.updateRunStepByRunIdAndNodeId(run.id, humanNode.id, {
    finishedAt: new Date(),
    humanResponse: response,
    status: FlowRunStepStatus.succeeded,
  })
  await flowService.markRunRunning(run.id)

  const refreshedRun = await flowService.findRunByIdAndUserId(run.id, params.userId)
  if (!refreshedRun) return { ok: false, error: 'not_found' }

  void resumeClaimedFlowRun({
    flow: claimedFlow,
    previousOutput: response,
    run: refreshedRun,
    startNodeId: getOutgoingTargets(definitionResult.definition, humanNode.id)[0] ?? null,
  }).catch((error) => {
    console.error('[flows] Failed to resume flow run', {
      error,
      flowId: claimedFlow.id,
      runId: run.id,
    })
  })

  return { ok: true, run: serializeFlowRun(refreshedRun) }
}

async function resumeClaimedFlowRun(params: {
  flow: FlowRecord
  previousOutput: string | null
  run: FlowRunDetailRecord
  startNodeId: string | null
}): Promise<void> {
  let outcome: FlowExecutionOutcome = { status: 'failed', error: 'flow_resume_failed' }
  let slug: string | null = null

  try {
    const owner = await userService.findByIdSelect(params.flow.userId, { slug: true })
    if (!owner) throw new Error('flow_user_not_found')

    slug = owner.slug
    await ensureWorkspaceRunningForExecution(slug, params.flow.userId)
    const client = await createInstanceClient(slug)
    if (!client) throw new Error('instance_unavailable')

    outcome = await continueRun({
      client,
      flow: params.flow,
      leaseOwner: params.flow.leaseOwner ?? '',
      previousOutput: params.previousOutput,
      run: params.run,
      sessionId: params.run.openCodeSessionId ?? '',
      slug,
      startNodeId: params.startNodeId,
    })
  } catch (error) {
    outcome = { status: 'failed', error: error instanceof Error ? error.message : 'flow_resume_failed' }
  } finally {
    await finalizeRun({
      flow: params.flow,
      outcome,
      run: params.run,
      sessionId: params.run.openCodeSessionId,
      sessionTitle: params.run.sessionTitle,
      slug: slug ?? '',
      trigger: FlowRunTrigger.resume,
    }).catch(() => undefined)

    await flowService.releaseFlowLease(
      params.flow.id,
      params.flow.leaseOwner ?? '',
      outcome.status === 'waiting_for_human' ? undefined : new Date(),
    ).catch(() => undefined)
  }
}
