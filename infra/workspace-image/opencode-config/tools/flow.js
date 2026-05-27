import { z } from 'zod'

import { toToolOutput } from '../shared/attachment-tools.js'

const FLOW_TEMPLATE_FORMAT = 'arche-flow-template/v1'
const FLOW_AUTHORING_SKILL_NAME = 'arche-flow-authoring'
const MAX_NAME_CHARS = 160
const MAX_DESCRIPTION_CHARS = 1000
const MAX_PROMPT_CHARS = 20000
const FLOW_NODE_TYPES = ['agent', 'human', 'condition', 'slack', 'merge', 'compaction']
const FLOW_TEMPLATE_VARIABLES = [
  '{{previous.output}}',
  '{{flow.name}}',
  '{{run.id}}',
  '{{steps.<nodeId>.output}}',
  '{{human.<nodeId>.response}}',
]
const CONDITION_OPERATORS = new Set([
  'contains',
  'ends_with',
  'equals',
  'exists',
  'matches',
  'not_equals',
  'not_exists',
  'starts_with',
])
const SLACK_MESSAGE_MODES = new Set(['fixed', 'previous_output', 'template'])
const MONTH_NAMES = new Map([
  ['JAN', 1],
  ['FEB', 2],
  ['MAR', 3],
  ['APR', 4],
  ['MAY', 5],
  ['JUN', 6],
  ['JUL', 7],
  ['AUG', 8],
  ['SEP', 9],
  ['OCT', 10],
  ['NOV', 11],
  ['DEC', 12],
])
const WEEKDAY_NAMES = new Map([
  ['SUN', 0],
  ['MON', 1],
  ['TUE', 2],
  ['WED', 3],
  ['THU', 4],
  ['FRI', 5],
  ['SAT', 6],
])

const proposeArgsSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS).nullable().optional(),
  definition: z.unknown(),
  enabled: z.boolean().optional(),
  cronExpression: z.string().max(100).nullable().optional(),
  timezone: z.string().max(100).optional(),
}).strict()

function getInvalidFlowProposalHint(error) {
  if (error === 'invalid_definition_version') {
    return 'Pass only FlowDefinition as definition: { version: 1, startNodeId, nodes, edges, layout? }. Do not pass the full template or format field as definition.'
  }

  if (error === 'invalid_flow_nodes') {
    return 'Each node needs id, name, and one supported type: agent, human, condition, slack, merge, or compaction. See help.nodeTypes for required fields.'
  }

  if (error === 'invalid_flow_edges') {
    return 'Each edge needs id, sourceNodeId, and targetNodeId. Source and target must reference existing node ids.'
  }

  if (error.startsWith('unknown_template_variable:')) {
    return 'Use only supported template variables such as {{previous.output}}, {{flow.name}}, {{steps.<nodeId>.output}}, and {{human.<nodeId>.response}}.'
  }

  return 'Use the arche-flow-authoring skill for the FlowDefinition schema, supported node types, agent targeting rules, and template variables.'
}

function invalidFlowProposal(error) {
  const hint = getInvalidFlowProposalHint(error)
  return toToolOutput({
    ok: false,
    error,
    format: FLOW_TEMPLATE_FORMAT,
    help: {
      definition: {
        required: ['version', 'startNodeId', 'nodes', 'edges'],
        version: 1,
      },
      nodeTypes: FLOW_NODE_TYPES,
      portableAgentTarget: 'Set agent targetAgentId to null unless the user explicitly plans to remap agents later.',
      skill: FLOW_AUTHORING_SKILL_NAME,
      templateVariables: FLOW_TEMPLATE_VARIABLES,
    },
    helpSkill: FLOW_AUTHORING_SKILL_NAME,
    hint,
    validation: { ok: false, error, hint },
  })
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value, maxChars, required = true) {
  if (value === null || value === undefined) return required ? null : undefined
  const text = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!text) return required ? null : undefined
  if (text.length > maxChars) return null
  return text
}

function readString(record, key, maxChars = MAX_PROMPT_CHARS) {
  return normalizeText(record[key], maxChars)
}

function readOptionalString(record, key, maxChars = MAX_PROMPT_CHARS) {
  return normalizeText(record[key], maxChars, false)
}

function parseConditionRule(value) {
  if (!isRecord(value)) return null

  const id = readString(value, 'id')
  const variable = readString(value, 'variable')
  const targetNodeId = readString(value, 'targetNodeId')
  if (!id || !variable || !targetNodeId || !CONDITION_OPERATORS.has(value.operator)) return null

  return {
    id,
    operator: value.operator,
    targetNodeId,
    value: readOptionalString(value, 'value'),
    variable,
  }
}

function parseSlackTarget(value) {
  if (!isRecord(value)) return null


  if (value.type === 'dm') {
    const userId = readString(value, 'userId')
    return userId ? { type: 'dm', userId } : null
  }

  if (value.type === 'channel') {
    const channelId = readString(value, 'channelId')
    return channelId ? { type: 'channel', channelId } : null
  }

  return null
}

function parseNode(value, warnings) {
  if (!isRecord(value)) return null

  const id = readString(value, 'id')
  const name = readString(value, 'name', MAX_NAME_CHARS)
  if (!id || !name || typeof value.type !== 'string') return null

  if (value.type === 'agent') {
    const promptTemplate = readString(value, 'promptTemplate')
    if (!promptTemplate) return null
    if (typeof value.targetAgentId === 'string' && value.targetAgentId.trim()) {
      warnings.push({
        code: 'target_agent_reset',
        message: `Agent step "${name}" was made portable by setting targetAgentId to null.`,
        nodeId: id,
      })
    }

    return {
      compactOutput: typeof value.compactOutput === 'boolean' ? value.compactOutput : false,
      id,
      name,
      promptTemplate,
      targetAgentId: null,
      type: 'agent',
    }
  }

  if (value.type === 'human') {
    const instructions = readString(value, 'instructions')
    if (!instructions) return null

    return {
      id,
      instructions,
      name,
      required: typeof value.required === 'boolean' ? value.required : true,
      type: 'human',
    }
  }

  if (value.type === 'condition') {
    const mode = value.mode === 'ai' ? 'ai' : value.mode === 'rules' ? 'rules' : null
    if (!mode) return null

    const rules = Array.isArray(value.rules) ? value.rules.map(parseConditionRule) : undefined
    if (rules?.some((rule) => rule === null)) return null
    const evaluatorPrompt = readOptionalString(value, 'evaluatorPrompt')
    if (mode === 'rules' && (!rules || rules.length === 0)) return null
    if (mode === 'ai' && !evaluatorPrompt) return null

    return {
      evaluatorPrompt,
      id,
      mode,
      name,
      rules,
      type: 'condition',
    }
  }

  if (value.type === 'slack') {
    const messageMode = value.messageMode
    const messageTemplate = typeof value.messageTemplate === 'string'
      ? value.messageTemplate.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      : ''
    const target = parseSlackTarget(value.target)
    if (!SLACK_MESSAGE_MODES.has(messageMode) || !target) return null
    if (messageMode !== 'previous_output' && messageTemplate.trim().length === 0) return null

    return {
      id,
      messageMode,
      messageTemplate,
      name,
      target,
      type: 'slack',
    }
  }

  if (value.type === 'merge') {
    return { id, name, type: 'merge' }
  }

  if (value.type === 'compaction') {
    const promptTemplate = readString(value, 'promptTemplate')
    return promptTemplate ? { id, name, promptTemplate, type: 'compaction' } : null
  }

  return null
}

function parseEdge(value) {
  if (!isRecord(value)) return null

  const id = readString(value, 'id')
  const sourceNodeId = readString(value, 'sourceNodeId')
  const targetNodeId = readString(value, 'targetNodeId')
  if (!id || !sourceNodeId || !targetNodeId) return null

  return {
    id,
    label: readOptionalString(value, 'label', MAX_NAME_CHARS),
    sourceNodeId,
    targetNodeId,
  }
}

function parseLayout(value) {
  if (value === undefined) return undefined
  if (!isRecord(value) || !Array.isArray(value.nodes)) return null

  const nodes = []
  for (const item of value.nodes) {
    if (!isRecord(item) || typeof item.x !== 'number' || typeof item.y !== 'number') return null
    const nodeId = readString(item, 'nodeId')
    if (!nodeId || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return null
    nodes.push({ nodeId, x: item.x, y: item.y })
  }

  return { nodes }
}

function edgeKey(sourceNodeId, targetNodeId) {
  return `${sourceNodeId}\0${targetNodeId}`
}

function createConditionRuleEdgeId(edgeIds, rule) {
  const base = `condition-rule-${rule.id}`
  let candidate = base
  let suffix = 2

  while (edgeIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }

  return candidate
}

function traversalTargets(definition, nodeId) {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)
  if (node?.type === 'condition') return (node.rules || []).map((rule) => rule.targetNodeId)
  return definition.edges.filter((edge) => edge.sourceNodeId === nodeId).map((edge) => edge.targetNodeId)
}

function hasCycle(definition) {
  const visiting = new Set()
  const visited = new Set()

  function visit(nodeId) {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false

    visiting.add(nodeId)
    for (const target of traversalTargets(definition, nodeId)) {
      if (visit(target)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }

  return definition.nodes.some((node) => visit(node.id))
}

function normalizeFlowDefinition(value, warnings) {
  if (!isRecord(value) || value.version !== 1) return { ok: false, error: 'invalid_definition_version' }
  const startNodeId = readString(value, 'startNodeId')
  if (!startNodeId || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return { ok: false, error: 'invalid_definition' }
  }

  const nodes = value.nodes.map((node) => parseNode(node, warnings))
  if (nodes.length === 0 || nodes.some((node) => node === null)) {
    return { ok: false, error: 'invalid_flow_nodes' }
  }

  const edges = value.edges.map(parseEdge)
  if (edges.some((edge) => edge === null)) return { ok: false, error: 'invalid_flow_edges' }
  const layout = parseLayout(value.layout)
  if (layout === null) return { ok: false, error: 'invalid_flow_layout' }

  const definition = { edges, layout, nodes, startNodeId, version: 1 }
  const nodeIds = new Set()
  const edgeIds = new Set()
  const edgeKeys = new Set()

  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) return { ok: false, error: 'duplicate_flow_node_id' }
    nodeIds.add(node.id)
  }
  if (!nodeIds.has(definition.startNodeId)) return { ok: false, error: 'unknown_start_node' }

  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) return { ok: false, error: 'duplicate_flow_edge_id' }
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      return { ok: false, error: 'unknown_flow_edge_node' }
    }
    if (edge.sourceNodeId === edge.targetNodeId) return { ok: false, error: 'cyclic_flow' }
    edgeKeys.add(edgeKey(edge.sourceNodeId, edge.targetNodeId))
  }

  for (const node of definition.nodes) {
    if (node.type !== 'condition') continue
    for (const rule of node.rules || []) {
      if (!nodeIds.has(rule.targetNodeId)) return { ok: false, error: 'unknown_condition_target' }
      if (rule.targetNodeId === node.id) return { ok: false, error: 'cyclic_flow' }
      const key = edgeKey(node.id, rule.targetNodeId)
      if (!edgeKeys.has(key)) {
        const edgeId = createConditionRuleEdgeId(edgeIds, rule)
        definition.edges.push({ id: edgeId, sourceNodeId: node.id, targetNodeId: rule.targetNodeId })
        edgeIds.add(edgeId)
        edgeKeys.add(key)
      }
    }
  }

  if (definition.layout) {
    for (const node of definition.layout.nodes) {
      if (!nodeIds.has(node.nodeId)) return { ok: false, error: 'unknown_layout_node' }
    }
  }

  if (hasCycle(definition)) return { ok: false, error: 'cyclic_flow' }
  return { ok: true, definition }
}

function normalizeTimezone(value) {
  const timezone = normalizeText(value ?? 'UTC', 100)
  if (!timezone) return null

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date())
    return timezone
  } catch {
    return null
  }
}

function parseCronFieldValue(value, min, max, aliases = new Map()) {
  const alias = aliases.get(value.toUpperCase())
  if (alias !== undefined) return alias
  if (!/^\d+$/.test(value)) return null

  const parsed = Number.parseInt(value, 10)
  return parsed >= min && parsed <= max ? parsed : null
}

function isValidCronFieldRange(value, min, max, aliases) {
  if (value === '*') return true

  const [start, end] = value.split('-')
  if (!end) return parseCronFieldValue(start, min, max, aliases) !== null

  const startValue = parseCronFieldValue(start, min, max, aliases)
  const endValue = parseCronFieldValue(end, min, max, aliases)
  return startValue !== null && endValue !== null && startValue <= endValue
}

function isValidCronFieldPart(part, min, max, aliases = new Map()) {
  const [range, step, extra] = part.split('/')
  if (!range || extra !== undefined) return false

  if (step !== undefined) {
    if (!/^\d+$/.test(step)) return false
    const stepValue = Number.parseInt(step, 10)
    if (stepValue < 1) return false
  }

  return isValidCronFieldRange(range, min, max, aliases)
}

function isValidCronField(field, min, max, aliases) {
  return field.split(',').every((part) => isValidCronFieldPart(part, min, max, aliases))
}

function normalizeCronExpression(value) {
  if (value === null || value === undefined || value === '') return { ok: true, cronExpression: null }
  const cronExpression = normalizeText(value, 100)
  if (!cronExpression) return { ok: false }
  const fields = cronExpression.split(/\s+/)
  if (fields.length !== 5) return { ok: false }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (!isValidCronField(minute, 0, 59)) return { ok: false }
  if (!isValidCronField(hour, 0, 23)) return { ok: false }
  if (!isValidCronField(dayOfMonth, 1, 31)) return { ok: false }
  if (!isValidCronField(month, 1, 12, MONTH_NAMES)) return { ok: false }
  if (!isValidCronField(dayOfWeek, 0, 7, WEEKDAY_NAMES)) return { ok: false }

  return { ok: true, cronExpression }
}

export const propose = {
  description: 'Propose a portable Arche flow template. Use the arche-flow-authoring skill for the FlowDefinition schema before calling this tool. This validates and normalizes the flow definition, but only returns a draft template for the user to review and create in the Flows editor. Set targetAgentId to null for agent steps unless the user explicitly plans to remap agents later.',
  args: {
    name: z.string().min(1).max(MAX_NAME_CHARS).describe('Flow name.'),
    description: z.string().max(MAX_DESCRIPTION_CHARS).nullable().optional().describe('Optional flow description.'),
    definition: z.unknown().describe('FlowDefinition JSON only, not the full template: { version: 1, startNodeId, nodes, edges, layout? }. Supported node types: agent, human, condition, slack, merge, compaction. Use targetAgentId: null for portable agent nodes.'),
    enabled: z.boolean().optional().describe('Whether the imported draft should have scheduling enabled.'),
    cronExpression: z.string().max(100).nullable().optional().describe('Optional 5-field cron expression to preserve in the draft.'),
    timezone: z.string().max(100).optional().describe('IANA timezone for the schedule. Defaults to UTC.'),
  },
  async execute(args) {
    const parsed = proposeArgsSchema.safeParse(args)
    if (!parsed.success) return invalidFlowProposal('schema_validation_failed')

    const warnings = []
    const name = normalizeText(parsed.data.name, MAX_NAME_CHARS)
    const description = normalizeText(parsed.data.description, MAX_DESCRIPTION_CHARS, false) ?? null
    const timezone = normalizeTimezone(parsed.data.timezone)
    const cronExpression = normalizeCronExpression(parsed.data.cronExpression)
    const definition = normalizeFlowDefinition(parsed.data.definition, warnings)

    if (!name) return invalidFlowProposal('invalid_name')
    if (!timezone) return invalidFlowProposal('invalid_timezone')
    if (!cronExpression.ok) return invalidFlowProposal('invalid_cron_expression')
    if (!definition.ok) return invalidFlowProposal(definition.error)

    const enabled = parsed.data.enabled === true
    if (enabled && !cronExpression.cronExpression) {
      warnings.push({
        code: 'schedule_required',
        message: 'This template is enabled but has no cron schedule. Add a schedule or disable it before saving.',
      })
    }

    return toToolOutput({
      ok: true,
      format: FLOW_TEMPLATE_FORMAT,
      validation: { ok: true },
      warnings,
      template: {
        cronExpression: cronExpression.cronExpression,
        definition: definition.definition,
        description,
        enabled,
        format: FLOW_TEMPLATE_FORMAT,
        name,
        timezone,
      },
    })
  },
}
