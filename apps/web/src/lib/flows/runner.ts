import {
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTrigger,
} from '@prisma/client'

import { createFlowActorScope } from '@/lib/flows/authorization'
import { formatFlowRunDate } from '@/lib/flows/cron'
import { dispatchFlowExecution } from '@/lib/flows/execution-dispatcher'
import { getFlowNodeById, getFlowOutgoingTargets } from '@/lib/flows/graph'
import { executeFlowNode } from '@/lib/flows/node-executors'
import { planFlowRetry } from '@/lib/flows/retry-policy'
import { validateFlowSlackNodeAccess } from '@/lib/flows/route-auth'
import { serializeFlowRun } from '@/lib/flows/serializers'
import {
  createFlowLeaseOwner,
  FLOW_LEASE_MS,
} from '@/lib/flows/session-executor'
import type { FlowDefinition } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { createInstanceClient } from '@/lib/opencode/client'
import { ensureProviderAccessFreshForExecution } from '@/lib/opencode/providers'
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
  | { status: 'termination_unconfirmed'; cause: string }

// A run whose runtime termination could not be confirmed must never be finalized:
// the excluded arm keeps that invariant enforced by the compiler instead of by a guard.
type FlowSettleableOutcome = Exclude<FlowExecutionOutcome, { status: 'termination_unconfirmed' }>

type FlowExecutionUser = {
  id: string
  role: string
  slug: string
}

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

async function validateFlowDefinitionForExecution(
  flow: FlowRecord,
  executionUser: FlowExecutionUser,
): Promise<{ ok: true; definition: FlowDefinition } | { ok: false; error: string }> {
  const definitionResult = validateFlowDefinition(flow.definition)
  if (!definitionResult.ok) return { ok: false, error: definitionResult.error }

  const slackNodeAccess = await validateFlowSlackNodeAccess(
    definitionResult.definition,
    executionUser,
    executionUser.id,
  )
  if (!slackNodeAccess.ok) return { ok: false, error: slackNodeAccess.error }

  return { ok: true, definition: definitionResult.definition }
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

    // Force a token refresh between steps so each step after the first starts
    // with the full gateway-token TTL: flow steps run for minutes, so a
    // freshness-threshold check here would skip until the token is nearly
    // expired and hand the next step a token that dies mid-step. The first
    // iteration is exempt — the run entry points already force a fresh sync
    // before the loop starts. The flow's own message run is finalized between
    // steps, so this only defers when an unrelated run is active — the case
    // where a concurrent sync (which disposes the instance) must not run.
    if (visitedNodeIds.size > 0) {
      try {
        await ensureProviderAccessFreshForExecution({
          slug: params.slug,
          userId: params.executionUserId,
          force: true,
        })
      } catch (error) {
        console.warn('[flows] Failed to refresh provider access between steps', {
          error: error instanceof Error ? error.message : String(error),
          flowId: params.flow.id,
          runId: params.run.id,
        })
      }
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
    if (result.status === 'termination_unconfirmed') {
      return { status: 'termination_unconfirmed', cause: result.cause }
    }
    if (result.status === 'waiting_for_human') return { status: 'waiting_for_human', nodeId: result.nodeId }

    previousOutput = result.previousOutput
    currentNodeId = result.nextNodeId
  }

  return { status: 'succeeded' }
}

async function continueRun(params: {
  client: SessionExecutionClient
  definition: FlowDefinition
  flow: FlowRecord
  executionUserId: string
  leaseOwner: string
  previousOutput: string | null
  run: FlowRunRecord & { steps?: FlowRunStepRecord[] }
  sessionId: string
  slug: string
  startNodeId: string | null
}): Promise<FlowExecutionOutcome> {
  return executeFlowNodes({
    client: params.client,
    definition: params.definition,
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
  outcome: FlowSettleableOutcome
  run: FlowRunRecord
  sessionId: string | null
  sessionTitle: string | null
  slug: string
  trigger: FlowRunTrigger
}): Promise<{ retryScheduled: boolean }> {
  if (!await hasActiveFlowLease(params.flow.id, params.leaseOwner)) return { retryScheduled: false }

  const executionUserId = params.run.executionUserId ?? params.flow.userId
  const currentRun = await flowService.findRunByIdForScope(
    params.run.id,
    createFlowActorScope({ id: params.flow.userId, role: 'USER' }, params.flow.userId),
  )
  if (params.outcome.status === 'cancelled' || currentRun?.status === FlowRunStatus.cancelled) {
    return { retryScheduled: false }
  }

  if (params.outcome.status === 'waiting_for_human') {
    await auditService.createEvent({
      action: 'flows.run_waiting_for_human',
      actorUserId: executionUserId,
      metadata: {
        executionUserId,
        flowId: params.flow.id,
        nodeId: params.outcome.nodeId,
        ownerUserId: params.flow.userId,
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
      actorUserId: executionUserId,
      metadata: {
        executionUserId,
        flowId: params.flow.id,
        ownerUserId: params.flow.userId,
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
      actorUserId: executionUserId,
      metadata: {
        attempt: params.run.attempt,
        error: params.outcome.error,
        executionUserId,
        flowId: params.flow.id,
        maxAttempts: retryPlan.maxAttempts,
        ownerUserId: params.flow.userId,
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
    actorUserId: executionUserId,
    metadata: {
      error: params.outcome.error,
      executionUserId,
      flowId: params.flow.id,
      maxAttempts: retryPlan.maxAttempts,
      ownerUserId: params.flow.userId,
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

async function settleFlowRun(params: {
  flow: FlowRecord
  outcome: FlowExecutionOutcome
  run: FlowRunRecord
  sessionId: string | null
  sessionTitle: string | null
  slug: string
  trigger: FlowRunTrigger
}): Promise<void> {
  if (params.outcome.status === 'termination_unconfirmed') {
    console.error('[flows] Runtime termination unconfirmed; preserving flow run state', {
      cause: params.outcome.cause,
      flowId: params.flow.id,
    })
    return
  }

  const leaseOwner = params.flow.leaseOwner ?? ''
  const finalization = await finalizeRun({
    flow: params.flow,
    leaseOwner,
    outcome: params.outcome,
    run: params.run,
    sessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
    slug: params.slug,
    trigger: params.trigger,
  }).catch(() => ({ retryScheduled: false }))

  const result = await flowService.releaseFlowLease(
    params.flow.id,
    leaseOwner,
    params.outcome.status === 'waiting_for_human' || finalization.retryScheduled ? undefined : new Date(),
  ).catch(() => null)
  if (result && result.count !== 1) {
    console.warn('[flows] Flow lease release skipped because ownership changed', { flowId: params.flow.id })
  }
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

  try {
    const executionUserId = run.executionUserId ?? flow.userId
    const executionUser = await userService.findByIdSelect(executionUserId, { role: true, slug: true })
    if (!executionUser) throw new Error('flow_execution_user_not_found')

    slug = executionUser.slug
    const definitionResult = await validateFlowDefinitionForExecution(flow, {
      id: executionUserId,
      role: executionUser.role,
      slug: executionUser.slug,
    })
    if (!definitionResult.ok) {
      outcome = { status: 'failed', error: definitionResult.error }
      return
    }

    // Force a token refresh at flow start: a scheduled flow can begin long
    // after the last interactive sync, and would otherwise inherit a gateway
    // token with too little TTL left to cover the first step.
    await ensureWorkspaceRunningForExecution(slug, executionUserId, { forceProviderRefresh: true })
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

    outcome = await continueRun({
      client,
      definition: definitionResult.definition,
      executionUserId,
      flow,
      leaseOwner: flow.leaseOwner ?? '',
      previousOutput: run.currentNodeId ? getPreviousOutputForRetry(run) : null,
      run,
      sessionId,
      slug,
      startNodeId: run.currentNodeId ?? definitionResult.definition.startNodeId,
    })
  } catch (error) {
    outcome = { status: 'failed', error: error instanceof Error ? error.message : 'flow_run_failed' }
  } finally {
    await settleFlowRun({
      flow,
      outcome,
      run,
      sessionId,
      sessionTitle,
      slug: slug ?? '',
      trigger,
    })
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

  dispatchFlowExecution(
    { flowId: flow.id, runId: run.id, trigger, type: 'run' },
    () => executeClaimedFlowRun(flow, trigger, run),
  )

  return { ok: true, runId: run.id }
}

export async function dispatchClaimedFlowRetryRun(
  flow: FlowRetryClaimedRecord,
): Promise<{ ok: true; runId: string }> {
  dispatchFlowExecution(
    { flowId: flow.id, runId: flow.retryRun.id, trigger: flow.retryRun.trigger, type: 'retry' },
    () => executeClaimedFlowRun(flow, flow.retryRun.trigger, flow.retryRun),
  )

  return { ok: true, runId: flow.retryRun.id }
}

export async function triggerFlowNow(params: {
  executionUserId?: string
  flowId: string
  ownerUserId?: string
  trigger: FlowRunTrigger
}): Promise<{ ok: true; runId: string } | { ok: false; error: 'not_found' | 'flow_busy' }> {
  const now = new Date()
  const leaseOwner = await createFlowLeaseOwner()
  const claimed = await flowService.claimFlowForImmediateRun({
    id: params.flowId,
    leaseMs: FLOW_LEASE_MS,
    leaseOwner,
    now,
    ownerUserId: params.ownerUserId,
  })

  if (!claimed) {
    const flow = params.ownerUserId
      ? await flowService.findFlowByIdForScope(
        params.flowId,
        createFlowActorScope({ id: params.ownerUserId, role: 'USER' }, params.ownerUserId),
      )
      : null
    if (!flow && params.ownerUserId) return { ok: false, error: 'not_found' }
    return { ok: false, error: 'flow_busy' }
  }

  return dispatchClaimedFlowRun(claimed, params.trigger, params.executionUserId ?? claimed.userId)
}

export async function resumeFlowRun(params: {
  humanResponse: string
  runId: string
  userId: string
}): Promise<{ ok: true; run: ReturnType<typeof serializeFlowRun> } | { ok: false; error: 'invalid_response' | 'invalid_state' | 'not_found' | 'flow_busy' }> {
  const scope = createFlowActorScope({ id: params.userId, role: 'USER' }, params.userId)
  const run = await flowService.findRunByIdForScope(params.runId, scope)
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
    ownerUserId: run.flow.userId,
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

  const refreshedRun = await flowService.findRunByIdForScope(run.id, scope)
  if (!refreshedRun) return { ok: false, error: 'not_found' }

  dispatchFlowExecution(
    { flowId: claimedFlow.id, runId: run.id, trigger: FlowRunTrigger.resume, type: 'resume' },
    () => resumeClaimedFlowRun({
      flow: claimedFlow,
      previousOutput: response,
      run: refreshedRun,
      startNodeId: nextNodeId,
    }),
  )

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
    const executionUserId = params.run.executionUserId ?? params.flow.userId
    const executionUser = await userService.findByIdSelect(executionUserId, { role: true, slug: true })
    if (!executionUser) throw new Error('flow_execution_user_not_found')

    slug = executionUser.slug
    if (!params.startNodeId) {
      outcome = { status: 'succeeded' }
      return
    }

    const definitionResult = await validateFlowDefinitionForExecution(params.flow, {
      id: executionUserId,
      role: executionUser.role,
      slug: executionUser.slug,
    })
    if (!definitionResult.ok) {
      outcome = { status: 'failed', error: definitionResult.error }
      return
    }

    await ensureWorkspaceRunningForExecution(slug, executionUserId, { forceProviderRefresh: true })
    const client = await createInstanceClient(slug)
    if (!client) throw new Error('instance_unavailable')

    outcome = await continueRun({
      client,
      definition: definitionResult.definition,
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
    await settleFlowRun({
      flow: params.flow,
      outcome,
      run: params.run,
      sessionId: params.run.openCodeSessionId,
      sessionTitle: params.run.sessionTitle,
      slug: slug ?? '',
      trigger: FlowRunTrigger.resume,
    })
  }
}
