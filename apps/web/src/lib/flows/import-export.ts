import { assertValidFlowTimeZone, validateFlowCronExpression } from '@/lib/flows/cron'
import { validateFlowPayload } from '@/lib/flows/payload'
import { FLOW_TEMPLATE_FORMAT } from '@/lib/flows/template-format'
import type { FlowDefinition, FlowNode, FlowPayload } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { isRecord } from '@/lib/records'

export { FLOW_TEMPLATE_FORMAT }

export type FlowTemplate = {
  format: typeof FLOW_TEMPLATE_FORMAT
  name: string
  description: string | null
  definition: FlowDefinition
  enabled: boolean
  cronExpression: string | null
  timezone: string
}

export type FlowTemplateImportWarningCode =
  | 'agent_options_unavailable'
  | 'flow_name_exists'
  | 'schedule_required'
  | 'slack_dm_target_forbidden'
  | 'slack_integration_disabled'
  | 'slack_private_channel_forbidden'
  | 'unknown_slack_channel_target'
  | 'unknown_slack_dm_target'
  | 'unknown_target_agent'

export type FlowTemplateImportWarning = {
  code: FlowTemplateImportWarningCode
  message: string
  nodeId?: string
  value?: string
}

export type FlowTemplateImportValidationResult =
  | { ok: true; draftPayload: FlowPayload; template: FlowTemplate; warnings: FlowTemplateImportWarning[] }
  | { ok: false; error: string }

type FlowTemplateSource = {
  cronExpression: string | null
  definition: FlowDefinition
  description: string | null
  enabled: boolean
  name: string
  timezone: string
}

function readOptionalDescription(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readCronExpression(value: unknown, timezone: string): { ok: true; cronExpression: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, cronExpression: null }
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'invalid_cron_expression' }
  }

  try {
    return { ok: true, cronExpression: validateFlowCronExpression(value, timezone) }
  } catch {
    return { ok: false, error: 'invalid_cron_expression' }
  }
}

function cloneNodeForPayloadValidation(node: FlowNode): FlowNode {
  return node.type === 'agent' ? { ...node, targetAgentId: null } : node
}

function cloneDefinitionForPayloadValidation(definition: FlowDefinition): FlowDefinition {
  return {
    edges: definition.edges.map((edge) => ({ ...edge })),
    layout: definition.layout
      ? { nodes: definition.layout.nodes.map((node) => ({ ...node })) }
      : undefined,
    nodes: definition.nodes.map(cloneNodeForPayloadValidation),
    startNodeId: definition.startNodeId,
    version: 1,
  }
}

function scheduleRequiredWarning(): FlowTemplateImportWarning {
  return {
    code: 'schedule_required',
    message: 'This template is enabled but has no cron schedule. Add a schedule or disable it before saving.',
  }
}

function readFlowTemplateSource(value: unknown): { ok: true; source: FlowTemplateSource } | { ok: false; error: string } {
  if (!isRecord(value) || value.format !== FLOW_TEMPLATE_FORMAT) {
    return { ok: false, error: 'invalid_flow_template_format' }
  }

  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!name) {
    return { ok: false, error: 'invalid_name' }
  }

  const definitionResult = validateFlowDefinition(value.definition)
  if (!definitionResult.ok) {
    return { ok: false, error: definitionResult.error }
  }

  const rawTimezone = value.timezone === undefined ? 'UTC' : value.timezone
  if (typeof rawTimezone !== 'string') {
    return { ok: false, error: 'invalid_timezone' }
  }

  let timezone: string
  try {
    timezone = assertValidFlowTimeZone(rawTimezone)
  } catch {
    return { ok: false, error: 'invalid_timezone' }
  }

  const cronExpressionResult = readCronExpression(value.cronExpression, timezone)
  if (!cronExpressionResult.ok) {
    return cronExpressionResult
  }

  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    return { ok: false, error: 'invalid_enabled' }
  }

  return {
    ok: true,
    source: {
      cronExpression: cronExpressionResult.cronExpression,
      definition: definitionResult.definition,
      description: readOptionalDescription(value.description),
      enabled: value.enabled === true,
      name,
      timezone,
    },
  }
}

export function createFlowTemplate(source: FlowTemplateSource): FlowTemplate {
  return {
    cronExpression: source.cronExpression,
    definition: source.definition,
    description: source.description,
    enabled: source.enabled,
    format: FLOW_TEMPLATE_FORMAT,
    name: source.name,
    timezone: source.timezone,
  }
}

export async function validateFlowTemplateImport(value: unknown): Promise<FlowTemplateImportValidationResult> {
  const sourceResult = readFlowTemplateSource(value)
  if (!sourceResult.ok) return sourceResult

  const { source } = sourceResult
  const validationPayload: FlowPayload = {
    cronExpression: source.cronExpression,
    definition: cloneDefinitionForPayloadValidation(source.definition),
    description: source.description,
    enabled: source.enabled && source.cronExpression !== null,
    name: source.name,
    organizationCanRun: false,
    timezone: source.timezone,
    visibility: 'private',
  }
  const payloadResult = await validateFlowPayload(validationPayload, 'create')
  if (!payloadResult.ok) {
    return { ok: false, error: payloadResult.error }
  }

  const warnings = source.enabled && source.cronExpression === null
    ? [scheduleRequiredWarning()]
    : []

  return {
    ok: true,
    draftPayload: {
      cronExpression: source.cronExpression,
      definition: source.definition,
      description: source.description,
      enabled: source.enabled,
      name: payloadResult.value.name ?? source.name,
      organizationCanRun: false,
      timezone: payloadResult.value.timezone ?? source.timezone,
      visibility: 'private',
    },
    template: createFlowTemplate(source),
    warnings,
  }
}
