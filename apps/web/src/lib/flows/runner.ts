import {
  FlowNodeType as PrismaFlowNodeType,
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTrigger,
} from '@prisma/client'

import { formatFlowRunDate } from '@/lib/flows/cron'
import { getFlowNodeById, getFlowOutgoingTargets } from '@/lib/flows/graph'
import { serializeFlowRun, serializeSlackNotificationConfig, toPrismaJson } from '@/lib/flows/serializers'
import { createFlowLeaseOwner, FLOW_LEASE_MS, runFlowPromptAndReadOutput } from '@/lib/flows/session-executor'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { ConditionFlowNode, FlowConditionOperator, FlowDefinition, FlowNode } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { createInstanceClient } from '@/lib/opencode/client'
import {
  ensureWorkspaceRunningForExecution,
  type SessionExecutionClient,
} from '@/lib/opencode/session-execution'
import { isRecord } from '@/lib/records'
import { auditService, flowService, instanceService, userService } from '@/lib/services'
import type { FlowClaimedRecord, FlowRecord, FlowRunDetailRecord, FlowRunRecord, FlowRunStepRecord } from '@/lib/services/flow'
import { sendSlackNotifications } from '@/lib/slack/notifications'

export { FLOW_LEASE_MS } from '@/lib/flows/session-executor'

type FlowExecutionOutcome =
  | { status: 'succeeded' }
  | { status: 'waiting_for_human'; nodeId: string }
  | { status: 'failed'; error: string }

function buildFlowSessionTitle(flow: FlowRecord, scheduledFor: Date): string {
  return `Flow | ${flow.name} | ${formatFlowRunDate(scheduledFor, flow.timezone)}`
}

function buildFlowSessionLink(slug: string, sessionId: string): string | undefined {
  const publicBaseUrl = process.env.ARCHE_PUBLIC_BASE_URL?.trim()
  if (!publicBaseUrl || publicBaseUrl.includes('0.0.0.0') || publicBaseUrl.includes('::')) {
    return undefined
  }

  try {
    const url = new URL(publicBaseUrl)
    url.pathname = `/w/${slug}`
    url.searchParams.set('mode', 'flows')
    url.searchParams.set('session', sessionId)
    return url.toString()
  } catch {
    return undefined
  }
}

function getFlowNotificationOutput(run: FlowRunDetailRecord | null): string | null {
  if (!run) return null

  for (let index = run.steps.length - 1; index >= 0; index -= 1) {
    const step = run.steps[index]
    const output = step.compactedOutput ?? step.rawOutput ?? step.humanResponse
    if (output?.trim()) return output
  }

  return null
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsDelimitedTarget(value: string, targetNodeId: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(targetNodeId)}($|[^A-Za-z0-9_-])`).test(value)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
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

  const matches = targetNodeIds.filter((targetNodeId) => containsDelimitedTarget(trimmed, targetNodeId))
  return matches.length === 1 ? matches[0] : null
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

  let rawResult: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
  try {
    rawResult = await runFlowPromptAndReadOutput({
      agent: params.node.targetAgentId,
      client: params.client,
      flowId: params.flow.id,
      leaseOwner: params.leaseOwner,
      prompt: rendered.value,
      sessionId: params.sessionId,
      slug: params.slug,
    })
  } catch (error) {
    const message = errorMessage(error, 'flow_prompt_failed')
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: message,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: message, steps }
  }
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
    let compactResult: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
    try {
      compactResult = await runFlowPromptAndReadOutput({
        client: params.client,
        flowId: params.flow.id,
        leaseOwner: params.leaseOwner,
        prompt: compactPrompt,
        sessionId: params.sessionId,
        slug: params.slug,
      })
    } catch (error) {
      const message = errorMessage(error, 'flow_prompt_failed')
      steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
        error: message,
        finishedAt: new Date(),
        rawOutput: rawResult.output,
        status: FlowRunStepStatus.failed,
      }))
      return { ok: false, error: message, steps }
    }
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
  const outgoingTargets = getFlowOutgoingTargets(params.definition, params.node.id)

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
  if (!rendered.ok) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: rendered.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: rendered.error, steps }
  }

  const prompt = [
    rendered.value,
    '',
    'Choose exactly one target node id from this list and return only that id or JSON like {"targetNodeId":"..."}.',
    outgoingTargets.map((targetNodeId) => `- ${targetNodeId}`).join('\n'),
  ].join('\n')
  let aiResult: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
  try {
    aiResult = await runFlowPromptAndReadOutput({
      client: params.client,
      flowId: params.flow.id,
      leaseOwner: params.leaseOwner,
      prompt,
      sessionId: params.sessionId,
      slug: params.slug,
    })
  } catch (error) {
    const message = errorMessage(error, 'flow_prompt_failed')
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: message,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: message, steps }
  }
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
  const visitedNodeIds = new Set<string>()

  while (currentNodeId) {
    if (visitedNodeIds.has(currentNodeId)) {
      return { status: 'failed', error: 'cyclic_flow' }
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
      currentNodeId = getFlowOutgoingTargets(params.definition, node.id)[0] ?? null
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
      steps = replaceStep(steps, await flowService.upsertRunStep({
        input: toPrismaJson({ prompt: rendered.value }),
        nodeId: node.id,
        nodeName: node.name,
        nodeType: nodeTypeToPrisma(node),
        runId: params.run.id,
        startedAt: new Date(),
        status: FlowRunStepStatus.running,
      }))

      let result: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
      try {
        result = await runFlowPromptAndReadOutput({
          client: params.client,
          flowId: params.flow.id,
          leaseOwner: params.leaseOwner,
          prompt: rendered.value,
          sessionId: params.sessionId,
          slug: params.slug,
        })
      } catch (error) {
        const message = errorMessage(error, 'flow_prompt_failed')
        steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, node.id, {
          error: message,
          finishedAt: new Date(),
          status: FlowRunStepStatus.failed,
        }))
        return { status: 'failed', error: message }
      }
      if (!result.ok) {
        steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, node.id, {
          error: result.error,
          finishedAt: new Date(),
          status: FlowRunStepStatus.failed,
        }))
        return { status: 'failed', error: result.error }
      }

      steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, node.id, {
        compactedOutput: result.output,
        finishedAt: new Date(),
        rawOutput: result.output,
        status: FlowRunStepStatus.succeeded,
      }))
      previousOutput = result.output
      currentNodeId = getFlowOutgoingTargets(params.definition, node.id)[0] ?? null
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
    currentNodeId = getFlowOutgoingTargets(params.definition, node.id)[0] ?? null
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
  leaseOwner: string
  outcome: FlowExecutionOutcome
  run: FlowRunRecord
  sessionId: string | null
  sessionTitle: string | null
  slug: string
  trigger: FlowRunTrigger
}) {
  if (!await hasActiveFlowLease(params.flow.id, params.leaseOwner)) return

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
    const result = await flowService.markRunSucceeded(params.run.id, {
      finishedAt,
      openCodeSessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
    })
    if (result.count !== 1) return
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

      const slackNotificationConfig = serializeSlackNotificationConfig(params.flow.slackNotificationConfig)
      if (slackNotificationConfig?.enabled && params.sessionId && params.slug) {
        try {
          const output = getFlowNotificationOutput(currentRun)
          if (!output) {
            throw new Error('No flow output to send')
          }

          const notificationResult = await sendSlackNotifications({
            sessionLink: slackNotificationConfig.includeSessionLink
              ? buildFlowSessionLink(params.slug, params.sessionId)
              : undefined,
            source: 'flows',
            targets: slackNotificationConfig.targets,
            text: `Flow report: ${params.flow.name}\n\n${output}`,
          })

          if (!notificationResult.ok) {
            console.error('[flows] Failed to send Slack notification', notificationResult.error)
          } else if (notificationResult.failed > 0) {
            console.error('[flows] Partial Slack notification failure', {
              errors: notificationResult.errors,
              failed: notificationResult.failed,
              sent: notificationResult.sent,
            })
          }
        } catch (error) {
          console.error('[flows] Error sending Slack notification', error)
        }
      }
      return
    }

  const result = await flowService.markRunFailed(params.run.id, {
    error: params.outcome.error,
    finishedAt,
    openCodeSessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
  })
  if (result.count !== 1) return
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

async function executeClaimedFlowRun(
  flow: FlowClaimedRecord,
  trigger: FlowRunTrigger,
  run: FlowRunRecord,
): Promise<void> {
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
      leaseOwner: flow.leaseOwner ?? '',
      outcome,
      run,
      sessionId,
      sessionTitle,
      slug: slug ?? '',
      trigger,
    }).catch(() => undefined)

    const result = await flowService.releaseFlowLease(
      flow.id,
      flow.leaseOwner ?? '',
      outcome.status === 'waiting_for_human' ? undefined : new Date(),
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
    flowId: flow.id,
    scheduledFor: flow.scheduledFor,
    trigger,
  })

  await executeClaimedFlowRun(flow, trigger, run)
}

export async function dispatchClaimedFlowRun(
  flow: FlowClaimedRecord,
  trigger: FlowRunTrigger,
): Promise<{ ok: true; runId: string }> {
  const run = await flowService.createRun({
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

export async function triggerFlowNow(params: {
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

  await dispatchClaimedFlowRun(claimed, params.trigger)

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
    startNodeId: getFlowOutgoingTargets(definitionResult.definition, humanNode.id)[0] ?? null,
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
      leaseOwner: params.flow.leaseOwner ?? '',
      outcome,
      run: params.run,
      sessionId: params.run.openCodeSessionId,
      sessionTitle: params.run.sessionTitle,
      slug: slug ?? '',
      trigger: FlowRunTrigger.resume,
    }).catch(() => undefined)

    const result = await flowService.releaseFlowLease(
      params.flow.id,
      params.flow.leaseOwner ?? '',
      outcome.status === 'waiting_for_human' ? undefined : new Date(),
    ).catch(() => null)
    if (result && result.count !== 1) {
      console.warn('[flows] Flow lease release skipped because ownership changed', { flowId: params.flow.id })
    }
  }
}
