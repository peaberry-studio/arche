import {
  FlowNodeType as PrismaFlowNodeType,
  FlowRunStepStatus,
} from '@prisma/client'

import { getFlowOutgoingTargets } from '@/lib/flows/graph'
import { toPrismaJson } from '@/lib/flows/serializers'
import {
  FLOW_RUN_CANCELLED_ERROR,
  runFlowPromptAndReadOutput,
} from '@/lib/flows/session-executor'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { ConditionFlowNode, FlowConditionOperator, FlowDefinition, FlowNode, SlackFlowNode } from '@/lib/flows/types'
import type { SessionExecutionClient } from '@/lib/opencode/session-execution'
import { isRecord } from '@/lib/records'
import { flowService } from '@/lib/services'
import type { FlowRecord, FlowRunRecord, FlowRunStepRecord } from '@/lib/services/flow'
import { sendSlackNotifications } from '@/lib/slack/notifications'

export type FlowNodeExecutionResult =
  | { status: 'cancelled'; steps: FlowRunStepRecord[] }
  | { status: 'continue'; nextNodeId: string | null; previousOutput: string | null; steps: FlowRunStepRecord[] }
  | { status: 'failed'; error: string; steps: FlowRunStepRecord[] }
  | { status: 'waiting_for_human'; nodeId: string; steps: FlowRunStepRecord[] }

const CONDITION_MATCHES_PATTERN_MAX_LENGTH = 256
const CONDITION_MATCHES_VALUE_MAX_LENGTH = 4_096
const INVALID_TARGET_RAW_OUTPUT_MAX_LENGTH = 8_000

function nodeTypeToPrisma(node: FlowNode): PrismaFlowNodeType {
  switch (node.type) {
    case 'agent':
      return PrismaFlowNodeType.agent
    case 'human':
      return PrismaFlowNodeType.human
    case 'condition':
      return PrismaFlowNodeType.condition
    case 'slack':
      return PrismaFlowNodeType.slack
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

function isRegexQuantifierStart(value: string): boolean {
  return value === '*' || value === '+' || value === '?' || value === '{'
}

function isSafeConditionRegex(pattern: string): boolean {
  if (pattern.length > CONDITION_MATCHES_PATTERN_MAX_LENGTH) return false

  const groups: Array<{ hasAlternation: boolean; hasQuantifier: boolean }> = []
  let escaped = false
  let inCharClass = false
  let lastToken: 'group' | 'other' | null = null
  let lastGroupHadAlternation = false
  let lastGroupHadQuantifier = false

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]

    if (escaped) {
      if (!inCharClass && /[1-9]/.test(char)) return false
      escaped = false
      lastToken = 'other'
      lastGroupHadAlternation = false
      lastGroupHadQuantifier = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (inCharClass) {
      if (char === ']') inCharClass = false
      continue
    }

    if (char === '[') {
      inCharClass = true
      lastToken = 'other'
      lastGroupHadAlternation = false
      lastGroupHadQuantifier = false
      continue
    }

    if (char === '(') {
      if (pattern[index + 1] === '?' && pattern[index + 2] !== ':') return false
      groups.push({ hasAlternation: false, hasQuantifier: false })
      lastToken = null
      lastGroupHadAlternation = false
      lastGroupHadQuantifier = false
      continue
    }

    if (char === ')') {
      const group = groups.pop()
      if (group && groups.length > 0) {
        if (group.hasAlternation) groups[groups.length - 1].hasAlternation = true
        if (group.hasQuantifier) groups[groups.length - 1].hasQuantifier = true
      }
      lastToken = 'group'
      lastGroupHadAlternation = group?.hasAlternation ?? false
      lastGroupHadQuantifier = group?.hasQuantifier ?? false
      continue
    }

    if (char === '|' && groups.length > 0) {
      groups[groups.length - 1].hasAlternation = true
      lastToken = 'other'
      lastGroupHadAlternation = false
      lastGroupHadQuantifier = false
      continue
    }

    if (isRegexQuantifierStart(char)) {
      if (lastToken === 'group' && (lastGroupHadAlternation || lastGroupHadQuantifier)) return false
      if (groups.length > 0) groups[groups.length - 1].hasQuantifier = true
      lastToken = 'other'
      lastGroupHadAlternation = false
      lastGroupHadQuantifier = false
      continue
    }

    lastToken = 'other'
    lastGroupHadAlternation = false
    lastGroupHadQuantifier = false
  }

  return true
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
      if (value.length > CONDITION_MATCHES_VALUE_MAX_LENGTH || !isSafeConditionRegex(right)) return false
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

function truncateInvalidTargetOutput(output: string): string {
  if (output.length <= INVALID_TARGET_RAW_OUTPUT_MAX_LENGTH) return output

  return `${output.slice(0, INVALID_TARGET_RAW_OUTPUT_MAX_LENGTH)}\n[truncated ${output.length - INVALID_TARGET_RAW_OUTPUT_MAX_LENGTH} characters]`
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

function isFlowRunCancellation(error: string): boolean {
  return error === FLOW_RUN_CANCELLED_ERROR
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
      runId: params.run.id,
      sessionId: params.sessionId,
      slug: params.slug,
      userId: params.flow.userId,
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
    if (isFlowRunCancellation(rawResult.error)) return { ok: false, error: rawResult.error, steps }

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
        runId: params.run.id,
        sessionId: params.sessionId,
        slug: params.slug,
        userId: params.flow.userId,
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
      if (isFlowRunCancellation(compactResult.error)) return { ok: false, error: compactResult.error, steps }

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
  const outgoingTargetSet = new Set(outgoingTargets)

  if (params.node.mode === 'rules') {
    const matchedRule = (params.node.rules ?? []).find((rule) => {
      if (!outgoingTargetSet.has(rule.targetNodeId)) return false

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
      runId: params.run.id,
      sessionId: params.sessionId,
      slug: params.slug,
      userId: params.flow.userId,
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
    if (isFlowRunCancellation(aiResult.error)) return { ok: false, error: aiResult.error, steps }

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
      rawOutput: truncateInvalidTargetOutput(aiResult.output),
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

async function executeSlackNode(params: {
  flow: FlowRecord
  node: SlackFlowNode
  previousOutput: string | null
  run: FlowRunRecord
  steps: FlowRunStepRecord[]
}): Promise<
  | { ok: true; previousOutput: string | null; steps: FlowRunStepRecord[] }
  | { ok: false; error: string; steps: FlowRunStepRecord[] }
> {
  let text: string
  if (params.node.messageMode === 'previous_output') {
    if (!params.previousOutput?.trim()) {
      return { ok: false, error: 'slack_message_previous_output_missing', steps: params.steps }
    }
    text = params.previousOutput
  } else if (params.node.messageMode === 'template') {
    const rendered = renderFlowTemplate(params.node.messageTemplate, buildFlowTemplateContext({
      flowName: params.flow.name,
      previousOutput: params.previousOutput,
      runId: params.run.id,
      steps: params.steps,
    }))
    if (!rendered.ok) return { ok: false, error: rendered.error, steps: params.steps }
    text = rendered.value
  } else {
    text = params.node.messageTemplate
  }

  let steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ messageMode: params.node.messageMode, target: params.node.target, text }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.running,
  }))

  let result: Awaited<ReturnType<typeof sendSlackNotifications>>
  try {
    result = await sendSlackNotifications({
      source: 'flows',
      targets: [params.node.target],
      text,
    })
  } catch (error) {
    const message = errorMessage(error, 'slack_notification_failed')
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: message,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: message, steps }
  }

  if (!result.ok) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: result.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: result.error, steps }
  }

  if (result.failed > 0) {
    const detail = result.errors[0]?.error ?? 'slack_notification_failed'
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: detail,
      finishedAt: new Date(),
      rawOutput: text,
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: detail, steps }
  }

  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    finishedAt: new Date(),
    rawOutput: text,
    status: FlowRunStepStatus.succeeded,
  }))

  return { ok: true, previousOutput: params.previousOutput, steps }
}

async function executeHumanNode(params: {
  flow: FlowRecord
  node: Extract<FlowNode, { type: 'human' }>
  previousOutput: string | null
  run: FlowRunRecord
  steps: FlowRunStepRecord[]
}): Promise<FlowNodeExecutionResult> {
  const context = buildFlowTemplateContext({
    flowName: params.flow.name,
    previousOutput: params.previousOutput,
    runId: params.run.id,
    steps: params.steps,
  })
  const rendered = renderFlowTemplate(params.node.instructions, context)
  if (!rendered.ok) return { error: rendered.error, status: 'failed', steps: params.steps }

  const steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ instructions: rendered.value, required: params.node.required }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.waiting_for_human,
  }))
  await flowService.markRunWaitingForHuman(params.run.id, params.node.id)
  return { nodeId: params.node.id, status: 'waiting_for_human', steps }
}

async function executeCompactionNode(params: {
  client: SessionExecutionClient
  flow: FlowRecord
  leaseOwner: string
  node: Extract<FlowNode, { type: 'compaction' }>
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

  let result: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
  try {
    result = await runFlowPromptAndReadOutput({
      client: params.client,
      flowId: params.flow.id,
      leaseOwner: params.leaseOwner,
      prompt: rendered.value,
      runId: params.run.id,
      sessionId: params.sessionId,
      slug: params.slug,
      userId: params.flow.userId,
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
  if (!result.ok) {
    if (isFlowRunCancellation(result.error)) return { ok: false, error: result.error, steps }

    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: result.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: result.error, steps }
  }

  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    compactedOutput: result.output,
    finishedAt: new Date(),
    rawOutput: result.output,
    status: FlowRunStepStatus.succeeded,
  }))

  return { ok: true, previousOutput: result.output, steps }
}

async function executeMergeNode(params: {
  node: Extract<FlowNode, { type: 'merge' }>
  run: FlowRunRecord
  steps: FlowRunStepRecord[]
}): Promise<FlowRunStepRecord[]> {
  return replaceStep(params.steps, await flowService.upsertRunStep({
    finishedAt: new Date(),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.succeeded,
  }))
}

export async function executeFlowNode(params: {
  client: SessionExecutionClient
  definition: FlowDefinition
  flow: FlowRecord
  leaseOwner: string
  node: FlowNode
  previousOutput: string | null
  run: FlowRunRecord
  sessionId: string
  slug: string
  steps: FlowRunStepRecord[]
}): Promise<FlowNodeExecutionResult> {
  if (params.node.type === 'agent') {
    const result = await executeAgentNode({ ...params, node: params.node })
    if (!result.ok) {
      return isFlowRunCancellation(result.error)
        ? { status: 'cancelled', steps: result.steps }
        : { status: 'failed', error: result.error, steps: result.steps }
    }

    return {
      nextNodeId: getFlowOutgoingTargets(params.definition, params.node.id)[0] ?? null,
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  if (params.node.type === 'human') {
    return executeHumanNode({
      flow: params.flow,
      node: params.node,
      previousOutput: params.previousOutput,
      run: params.run,
      steps: params.steps,
    })
  }

  if (params.node.type === 'condition') {
    const result = await executeConditionNode({ ...params, node: params.node })
    if (!result.ok) {
      return isFlowRunCancellation(result.error)
        ? { status: 'cancelled', steps: result.steps }
        : { status: 'failed', error: result.error, steps: result.steps }
    }

    return {
      nextNodeId: result.nextNodeId,
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  if (params.node.type === 'slack') {
    const result = await executeSlackNode({
      flow: params.flow,
      node: params.node,
      previousOutput: params.previousOutput,
      run: params.run,
      steps: params.steps,
    })
    if (!result.ok) {
      return { status: 'failed', error: result.error, steps: result.steps }
    }

    return {
      nextNodeId: getFlowOutgoingTargets(params.definition, params.node.id)[0] ?? null,
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  if (params.node.type === 'compaction') {
    const result = await executeCompactionNode({ ...params, node: params.node })
    if (!result.ok) {
      return isFlowRunCancellation(result.error)
        ? { status: 'cancelled', steps: result.steps }
        : { status: 'failed', error: result.error, steps: result.steps }
    }

    return {
      nextNodeId: getFlowOutgoingTargets(params.definition, params.node.id)[0] ?? null,
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  const steps = await executeMergeNode({ node: params.node, run: params.run, steps: params.steps })
  return {
    nextNodeId: getFlowOutgoingTargets(params.definition, params.node.id)[0] ?? null,
    previousOutput: params.previousOutput,
    status: 'continue',
    steps,
  }
}
