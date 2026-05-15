import { listFlowAgentOptions } from '@/lib/flows/agents'
import { assertValidFlowTimeZone, validateFlowCronExpression } from '@/lib/flows/cron'
import { validateFlowTemplateVariables } from '@/lib/flows/template'
import type { FlowPayload } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { isRecord } from '@/lib/records'

type PayloadMode = 'create' | 'update'

type PayloadValidationResult =
  | { ok: true; value: Partial<FlowPayload> }
  | { ok: false; error: string; status: number }

type PayloadValidationOptions = {
  fallbackTimezone?: string
}

async function validateTargetAgents(definition: FlowPayload['definition']): Promise<PayloadValidationResult | null> {
  const targetAgentIds = Array.from(new Set(definition.nodes.flatMap((node) => (
    node.type === 'agent' && node.targetAgentId ? [node.targetAgentId] : []
  ))))
  if (targetAgentIds.length === 0) return null

  const agentsResult = await listFlowAgentOptions()
  if (!agentsResult.ok) {
    return {
      ok: false,
      error: agentsResult.error,
      status: agentsResult.error === 'kb_unavailable' ? 503 : 500,
    }
  }

  const agentIds = new Set(agentsResult.agents.map((agent) => agent.id))
  if (targetAgentIds.some((targetAgentId) => !agentIds.has(targetAgentId))) {
    return { ok: false, error: 'unknown_target_agent', status: 400 }
  }

  return null
}

function validateTemplates(definition: FlowPayload['definition']): PayloadValidationResult | null {
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  for (const node of definition.nodes) {
    if (node.type === 'agent') {
      const result = validateFlowTemplateVariables(node.promptTemplate, nodeIds)
      if (!result.ok) return { ok: false, error: result.error, status: 400 }
    }
    if (node.type === 'condition' && node.evaluatorPrompt) {
      const result = validateFlowTemplateVariables(node.evaluatorPrompt, nodeIds)
      if (!result.ok) return { ok: false, error: result.error, status: 400 }
    }
    if (node.type === 'compaction') {
      const result = validateFlowTemplateVariables(node.promptTemplate, nodeIds)
      if (!result.ok) return { ok: false, error: result.error, status: 400 }
    }
    if (node.type === 'slack' && node.messageMode === 'template') {
      const result = validateFlowTemplateVariables(node.messageTemplate, nodeIds)
      if (!result.ok) return { ok: false, error: result.error, status: 400 }
    }
  }

  return null
}

export async function validateFlowPayload(
  body: unknown,
  mode: PayloadMode,
  options: PayloadValidationOptions = {},
): Promise<PayloadValidationResult> {
  if (!isRecord(body)) {
    return { ok: false, error: 'invalid_body', status: 400 }
  }

  const value: Partial<FlowPayload> = {}

  if (mode === 'create' || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return { ok: false, error: 'invalid_name', status: 400 }
    }

    value.name = name
  }

  if (mode === 'create' || 'description' in body) {
    value.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null
  }

  if (mode === 'create' || 'definition' in body) {
    const definitionResult = validateFlowDefinition(body.definition)
    if (!definitionResult.ok) {
      return { ok: false, error: definitionResult.error, status: 400 }
    }

    const templateError = validateTemplates(definitionResult.definition)
    if (templateError) return templateError

    const targetAgentError = await validateTargetAgents(definitionResult.definition)
    if (targetAgentError) return targetAgentError

    value.definition = definitionResult.definition
  }

  if (mode === 'create' || 'timezone' in body) {
    if (typeof body.timezone !== 'string') {
      return { ok: false, error: 'invalid_timezone', status: 400 }
    }

    try {
      value.timezone = assertValidFlowTimeZone(body.timezone)
    } catch {
      return { ok: false, error: 'invalid_timezone', status: 400 }
    }
  }

  if (mode === 'create' || 'cronExpression' in body) {
    const rawCron = body.cronExpression
    if (rawCron === null || rawCron === undefined || rawCron === '') {
      value.cronExpression = null
    } else if (typeof rawCron === 'string') {
      const timezone = typeof body.timezone === 'string'
        ? body.timezone
        : value.timezone ?? options.fallbackTimezone ?? null
      if (!timezone) {
        return { ok: false, error: 'invalid_timezone', status: 400 }
      }

      try {
        value.cronExpression = validateFlowCronExpression(rawCron, timezone)
      } catch {
        return { ok: false, error: 'invalid_cron_expression', status: 400 }
      }
    } else {
      return { ok: false, error: 'invalid_cron_expression', status: 400 }
    }
  }

  if (mode === 'create' || 'enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return { ok: false, error: 'invalid_enabled', status: 400 }
    }

    value.enabled = body.enabled
  }

  const enabled = value.enabled ?? false
  if (enabled && value.cronExpression === null) {
    return { ok: false, error: 'schedule_required', status: 400 }
  }

  return { ok: true, value }
}
