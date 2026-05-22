import {
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTrigger,
} from '@prisma/client'

import { formatFlowRunDate } from '@/lib/flows/cron'
import { getFlowNodeById, getFlowOutgoingTargets } from '@/lib/flows/graph'
import { executeFlowNode } from '@/lib/flows/node-executors'
import { planFlowRetry } from '@/lib/flows/retry-policy'
import { serializeFlowRun } from '@/lib/flows/serializers'
import {
  createFlowLeaseOwner,
  FLOW_LEASE_MS,
} from '@/lib/flows/session-executor'
import type { FlowDefinition } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { createInstanceClient } from '@/lib/opencode/client'
import {
  ensureWorkspaceRunningForExecution,
  type SessionExecutionClient,
} from '@/lib/opencode/session-execution'
import { auditService, flowService, instanceService, userService } from '@/lib/services'
import type { FlowClaimedRecord, FlowRecord, FlowRetryClaimedRecord, FlowRunDetailRecord, FlowRunRecord, FlowRunStepRecord } from '@/lib/services/flow'

export { FLOW_LEASE_MS } from '@/lib/flows/session-executor'

type FlowExecutionOutcome =
  | { status: 'cancelled' }
  | { status: 'succeeded' }
  | { status: 'waiting_for_human'; nodeId: string }
  | { status: 'failed'; error: string }

function buildFlowSessionTitle(flow: FlowRecord, scheduledFor: Date): string {
  return `Flow | ${flow.name} | ${formatFlowRunDate(scheduledFor, flow.timezone)}`
}

function getStepOutput(step: FlowRunStepRecord): string | null {
  return step.compactedOutput ?? step.rawOutput ?? step.humanResponse
}

function getPreviousOutputForRetry(run: FlowRunRecord & { steps?: FlowRunStepRecord[] }): string | null {
  const steps = run.steps ?? []
  if (!run.currentNodeId) {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const output = getStepOutput(steps[index])
      if (output) return output
    }
    return null
  }

  const currentStepIndex = steps.findIndex((step) => step.nodeId === run.currentNodeId)
  const previousSteps = currentStepIndex === -1 ? steps : steps.slice(0, currentStepIndex)
  for (let index = previousSteps.length - 1; index >= 0; index -= 1) {
    const output = getStepOutput(previousSteps[index])
    if (output) return output
  }

  return null
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const run = await flowService.findRunStatusById(runId)
  return run?.status === FlowRunStatus.cancelled
}

async function hasActiveFlowLease(flowId: string, leaseOwner: string): Promise<boolean> {
  if (!leaseOwner) return false

  const result = await flowService.extendFlowLease(
    flowId,
    leaseOwner,
    new Date(Date.now() + FLOW_LEASE_MS),
  )

  if (result.count === 1) return true

  console.warn('[flows] Flow lease no longer owned by runner', { flowId })
  return false
}

async function executeFlowNodes(params: {
  client: SessionExecutionClient
  definition: FlowDefinition
  executionUserId: string
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
  const visitedNodeIds = new Set<string>()

  while (currentNodeId) {
    if (visitedNodeIds.has(currentNodeId)) {
      return { status: 'failed', error: 'cyclic_flow' }
    }

    if (await isRunCancelled(params.run.id)) {
      return { status: 'cancelled' }
    }

    if (!await hasActiveFlowLease(params.flow.id, params.leaseOwner)) {
      return { status: 'failed', error: 'flow_lease_lost' }
    }

    visitedNodeIds.add(currentNodeId)
    const node = getFlowNodeById(params.definition, currentNodeId)
    if (!node) {
      return { status: 'failed', error: 'flow_node_not_found' }
    }

    await flowService.updateRunCurrentNode(params.run.id, node.id)

    const result = await executeFlowNode({
      client: params.client,
      definition: params.definition,
      executionUserId: params.executionUserId,
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
    if (result.status === 'cancelled') return { status: 'cancelled' }
    if (result.status === 'failed') return { status: 'failed', error: result.error }
    if (result.status === 'waiting_for_human') return { status: 'waiting_for_human', nodeId: result.nodeId }

    previousOutput = result.previousOutput
    currentNodeId = result.nextNodeId
  }

  return { status: 'succeeded' }
}

async function continueRun(params: {
  client: SessionExecutionClient
  flow: FlowRecord
  executionUserId: string
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
    executionUserId: params.executionUserId,
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
  leaseOwner: string
  outcome: FlowExecutionOutcome
  run: FlowRunRecord
  sessionId: string | null
  sessionTitle: string | null
  slug: string
  trigger: FlowRunTrigger
}): Promise<{ retryScheduled: boolean }> {
  if (!await hasActiveFlowLease(params.flow.id, params.leaseOwner)) return { retryScheduled: false }

  const currentRun = await flowService.findRunByIdAndUserId(params.run.id, params.flow.userId)
  if (params.outcome.status === 'cancelled' || currentRun?.status === FlowRunStatus.cancelled) {
    return { retryScheduled: false }
  }

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
    return { retryScheduled: false }
  }

  const finishedAt = new Date()

  if (params.outcome.status === 'succeeded') {
    const result = await flowService.markRunSucceeded(params.run.id, {
      finishedAt,
      openCodeSessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
    })
    if (result.count !== 1) return { retryScheduled: false }
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

    return { retryScheduled: false }
  }

  const retryPlan = planFlowRetry({
    attempt: params.run.attempt,
    error: params.outcome.error,
    now: finishedAt,
  })

  if (retryPlan.ok) {
    const result = await flowService.markRunRetryScheduled(params.run.id, {
      attempt: retryPlan.nextAttempt,
      error: params.outcome.error,
      openCodeSessionId: params.sessionId,
      retryAt: retryPlan.retryAt,
      sessionTitle: params.sessionTitle,
    })
    if (result.count !== 1) return { retryScheduled: false }

    console.warn('[flows] Retry scheduled', {
      attempt: params.run.attempt,
      error: params.outcome.error,
      flowId: params.flow.id,
      maxAttempts: retryPlan.maxAttempts,
      retryAt: retryPlan.retryAt.toISOString(),
      runId: params.run.id,
    })

    await auditService.createEvent({
      action: 'flows.run_failed',
      actorUserId: params.flow.userId,
      metadata: {
        attempt: params.run.attempt,
        error: params.outcome.error,
        flowId: params.flow.id,
        maxAttempts: retryPlan.maxAttempts,
        retryAt: retryPlan.retryAt.toISOString(),
        runId: params.run.id,
        sessionId: params.sessionId,
        slug: params.slug,
        trigger: params.trigger,
        willRetry: true,
      },
    })
    return { retryScheduled: true }
  }

  const result = await flowService.markRunFailed(params.run.id, {
    error: params.outcome.error,
    finishedAt,
    openCodeSessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
  })
  if (result.count !== 1) return { retryScheduled: false }
  await auditService.createEvent({
    action: 'flows.run_failed',
    actorUserId: params.flow.userId,
    metadata: {
      error: params.outcome.error,
      flowId: params.flow.id,
      maxAttempts: retryPlan.maxAttempts,
      retryReason: retryPlan.reason,
      runId: params.run.id,
      sessionId: params.sessionId,
      slug: params.slug,
      trigger: params.trigger,
      willRetry: false,
    },
  })
  return { retryScheduled: false }
}

async function executeClaimedFlowRun(
  flow: FlowClaimedRecord,
  trigger: FlowRunTrigger,
  run: FlowRunRecord & { steps?: FlowRunStepRecord[] },
): Promise<void> {
  let sessionId: string | null = run.openCodeSessionId
  let sessionTitle: string | null = run.sessionTitle
  let slug: string | null = null
  let outcome: FlowExecutionOutcome = { status: 'failed', error: 'flow_run_failed' }
  let finalization: { retryScheduled: boolean } = { retryScheduled: false }

  try {
    const executionUserId = run.executionUserId ?? flow.userId
    const executionUser = await userService.findByIdSelect(executionUserId, { slug: true })
    if (!executionUser) throw new Error('flow_execution_user_not_found')

    slug = executionUser.slug
    await ensureWorkspaceRunningForExecution(slug, executionUserId)
    await instanceService.touchActivity(slug).catch(() => undefined)

    const client = await createInstanceClient(slug)
    if (!client) throw new Error('instance_unavailable')

    if (!sessionId) {
      sessionTitle = buildFlowSessionTitle(flow, flow.scheduledFor)
      const sessionResult = await client.session.create({ title: sessionTitle }, { throwOnError: true })
      if (!sessionResult.data) throw new Error('flow_session_create_failed')

      sessionId = sessionResult.data.id
      await flowService.attachRunSession(run.id, { openCodeSessionId: sessionId, sessionTitle })
    }

    if (!sessionTitle) {
      sessionTitle = buildFlowSessionTitle(flow, flow.scheduledFor)
    }

    const definitionResult = validateFlowDefinition(flow.definition)
    outcome = await continueRun({
      client,
      executionUserId,
      flow,
      leaseOwner: flow.leaseOwner ?? '',
      previousOutput: run.currentNodeId ? getPreviousOutputForRetry(run) : null,
      run,
      sessionId,
      slug,
      startNodeId: run.currentNodeId ?? (definitionResult.ok ? definitionResult.definition.startNodeId : null),
    })
  } catch (error) {
    outcome = { status: 'failed', error: error instanceof Error ? error.message : 'flow_run_failed' }
  } finally {
    finalization = await finalizeRun({
      flow,
      leaseOwner: flow.leaseOwner ?? '',
      outcome,
      run,
      sessionId,
      sessionTitle,
      slug: slug ?? '',
      trigger,
    }).catch(() => ({ retryScheduled: false }))

    const result = await flowService.releaseFlowLease(
      flow.id,
      flow.leaseOwner ?? '',
      outcome.status === 'waiting_for_human' || finalization.retryScheduled ? undefined : new Date(),
    ).catch(() => null)
    if (result && result.count !== 1) {
      console.warn('[flows] Flow lease release skipped because ownership changed', { flowId: flow.id })
    }
  }
}

export async function runClaimedFlow(
  flow: FlowClaimedRecord,
  trigger: FlowRunTrigger,
): Promise<void> {
  const run = await flowService.createRun({
    executionUserId: flow.userId,
    flowId: flow.id,
    scheduledFor: flow.scheduledFor,
    trigger,
  })

  await executeClaimedFlowRun(flow, trigger, run)
}

export async function dispatchClaimedFlowRun(
  flow: FlowClaimedRecord,
  trigger: FlowRunTrigger,
  executionUserId = flow.userId,
): Promise<{ ok: true; runId: string }> {
  const run = await flowService.createRun({
    executionUserId,
    flowId: flow.id,
    scheduledFor: flow.scheduledFor,
    trigger,
  })

  void executeClaimedFlowRun(flow, trigger, run).catch((error) => {
    console.error('[flows] Failed to execute dispatched flow run', {
      error,
      flowId: flow.id,
      runId: run.id,
      trigger,
    })
  })

  return { ok: true, runId: run.id }
}

export async function dispatchClaimedFlowRetryRun(
  flow: FlowRetryClaimedRecord,
): Promise<{ ok: true; runId: string }> {
  void executeClaimedFlowRun(flow, flow.retryRun.trigger, flow.retryRun).catch((error) => {
    console.error('[flows] Failed to execute dispatched flow retry', {
      error,
      flowId: flow.id,
      runId: flow.retryRun.id,
      trigger: flow.retryRun.trigger,
    })
  })

  return { ok: true, runId: flow.retryRun.id }
}

export async function triggerFlowNow(params: {
  executionUserId?: string
  flowId: string
  trigger: FlowRunTrigger
  userId?: string
}): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'flow_busy' }> {
  const now = new Date()
  const leaseOwner = await createFlowLeaseOwner()
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

  await dispatchClaimedFlowRun(claimed, params.trigger, params.executionUserId ?? claimed.userId)

  return { ok: true }
}

export async function resumeFlowRun(params: {
  humanResponse: string
  runId: string
  userId: string
}): Promise<{ ok: true; run: ReturnType<typeof serializeFlowRun> } | { ok: false; error: 'invalid_response' | 'invalid_state' | 'not_found' | 'flow_busy' }> {
  const run = await flowService.findRunByIdAndUserId(params.runId, params.userId)
  if (!run) return { ok: false, error: 'not_found' }
  const executionUserId = run.executionUserId ?? run.flow.userId
  if (executionUserId !== params.userId) return { ok: false, error: 'not_found' }
  if (run.status !== FlowRunStatus.waiting_for_human || !run.currentNodeId || !run.openCodeSessionId) {
    return { ok: false, error: 'invalid_state' }
  }

  const definitionResult = validateFlowDefinition(run.flow.definition)
  if (!definitionResult.ok) return { ok: false, error: 'invalid_state' }

  const humanNode = getFlowNodeById(definitionResult.definition, run.currentNodeId)
  if (!humanNode || humanNode.type !== 'human') return { ok: false, error: 'invalid_state' }

  const response = params.humanResponse.trim()
  if (humanNode.required && !response) return { ok: false, error: 'invalid_response' }

  const leaseOwner = await createFlowLeaseOwner()
  const claimedFlow = await flowService.claimFlowLeaseById({
    id: run.flowId,
    leaseMs: FLOW_LEASE_MS,
    leaseOwner,
    now: new Date(),
    userId: run.flow.userId,
  })
  if (!claimedFlow) return { ok: false, error: 'flow_busy' }

  await flowService.updateRunStepByRunIdAndNodeId(run.id, humanNode.id, {
    finishedAt: new Date(),
    humanResponse: response,
    status: FlowRunStepStatus.succeeded,
  })
  const nextNodeId = getFlowOutgoingTargets(definitionResult.definition, humanNode.id)[0] ?? null
  await flowService.updateRunCurrentNode(run.id, nextNodeId)
  await flowService.markRunRunning(run.id)

  const refreshedRun = await flowService.findRunByIdAndUserId(run.id, params.userId)
  if (!refreshedRun) return { ok: false, error: 'not_found' }

  void resumeClaimedFlowRun({
    flow: claimedFlow,
    previousOutput: response,
    run: refreshedRun,
    startNodeId: nextNodeId,
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
  let finalization: { retryScheduled: boolean } = { retryScheduled: false }

  try {
    const executionUserId = params.run.executionUserId ?? params.flow.userId
    const executionUser = await userService.findByIdSelect(executionUserId, { slug: true })
    if (!executionUser) throw new Error('flow_execution_user_not_found')

    slug = executionUser.slug
    if (!params.startNodeId) {
      outcome = { status: 'succeeded' }
      return
    }

    await ensureWorkspaceRunningForExecution(slug, executionUserId)
    const client = await createInstanceClient(slug)
    if (!client) throw new Error('instance_unavailable')

    outcome = await continueRun({
      client,
      executionUserId,
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
    finalization = await finalizeRun({
      flow: params.flow,
      leaseOwner: params.flow.leaseOwner ?? '',
      outcome,
      run: params.run,
      sessionId: params.run.openCodeSessionId,
      sessionTitle: params.run.sessionTitle,
      slug: slug ?? '',
      trigger: FlowRunTrigger.resume,
    }).catch(() => ({ retryScheduled: false }))

    const result = await flowService.releaseFlowLease(
      params.flow.id,
      params.flow.leaseOwner ?? '',
      outcome.status === 'waiting_for_human' || finalization.retryScheduled ? undefined : new Date(),
    ).catch(() => null)
    if (result && result.count !== 1) {
      console.warn('[flows] Flow lease release skipped because ownership changed', { flowId: params.flow.id })
    }
  }
}
