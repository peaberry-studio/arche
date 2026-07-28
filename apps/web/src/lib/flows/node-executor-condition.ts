import { FlowRunStepStatus } from '@prisma/client'

import { getFlowOutgoingTargets } from '@/lib/flows/graph'
import type { FlowNodeExecutorFailure, FlowNodeExecutorOk, FlowNodeExecutorParams } from '@/lib/flows/node-executor-types'
import { errorMessage, isFlowRunCancellation, nodeTypeToPrisma, replaceStep } from '@/lib/flows/node-executor-utils'
import { toPrismaJson } from '@/lib/flows/serializers'
import { runFlowPromptAndReadOutput } from '@/lib/flows/session-executor'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { ConditionFlowNode, FlowConditionOperator, FlowNode } from '@/lib/flows/types'
import { isRecord } from '@/lib/records'
import { flowService } from '@/lib/services'

const CONDITION_MATCHES_PATTERN_MAX_LENGTH = 256
const CONDITION_MATCHES_VALUE_MAX_LENGTH = 4_096
const INVALID_TARGET_RAW_OUTPUT_MAX_LENGTH = 8_000

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

function resolveRuleVariable(params: {
  flowName: string
  previousOutput: string | null
  runId: string
  steps: FlowNodeExecutorParams['steps']
  variable: string
}): string | null {
  const template = `{{${params.variable}}}`
  const rendered = renderFlowTemplate(template, buildFlowTemplateContext({
    flowName: params.flowName,
    previousOutput: params.previousOutput,
    runId: params.runId,
    steps: params.steps,
  }))

  return rendered.ok ? rendered.value : null
}

export async function executeConditionNode(params: Omit<FlowNodeExecutorParams, 'node'> & {
  node: ConditionFlowNode
}): Promise<FlowNodeExecutorOk | FlowNodeExecutorFailure> {
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
        flowName: params.flow.name,
        previousOutput: params.previousOutput,
        runId: params.run.id,
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
    return { ok: false, status: 'failed', error: 'condition_has_no_targets', steps }
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
    return { ok: false, status: 'failed', error: rendered.error, steps }
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
      userId: params.executionUserId,
    })
  } catch (error) {
    const message = errorMessage(error, 'flow_prompt_failed')
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: message,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, status: 'failed', error: message, steps }
  }
  if (!aiResult.ok) {
    if (aiResult.type === 'termination_unconfirmed') {
      return { ok: false, status: 'termination_unconfirmed', cause: aiResult.cause, steps }
    }
    if (isFlowRunCancellation(aiResult.error)) return { ok: false, status: 'failed', error: aiResult.error, steps }

    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: aiResult.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, status: 'failed', error: aiResult.error, steps }
  }

  const nextNodeId = extractAiTarget(aiResult.output, outgoingTargets)
  if (!nextNodeId) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: 'condition_ai_invalid_target',
      finishedAt: new Date(),
      rawOutput: truncateInvalidTargetOutput(aiResult.output),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, status: 'failed', error: 'condition_ai_invalid_target', steps }
  }

  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    finishedAt: new Date(),
    rawOutput: aiResult.output,
    status: FlowRunStepStatus.succeeded,
  }))
  return { ok: true, nextNodeId, previousOutput: nextNodeId, steps }
}

export type ConditionNodeForExecutor = Extract<FlowNode, { type: 'condition' }>
