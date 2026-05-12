import { getFlowTraversalTargets } from '@/lib/flows/graph'
import { isRecord } from '@/lib/records'

import type {
  AgentFlowNode,
  CompactionFlowNode,
  ConditionFlowNode,
  FlowConditionOperator,
  FlowConditionRule,
  FlowDefinition,
  FlowEdge,
  FlowLayout,
  FlowLayoutNode,
  FlowNode,
  HumanFlowNode,
  MergeFlowNode,
} from '@/lib/flows/types'

export type FlowDefinitionValidationResult =
  | { ok: true; definition: FlowDefinition }
  | { ok: false; error: string }

const CONDITION_OPERATORS = new Set<FlowConditionOperator>([
  'contains',
  'ends_with',
  'equals',
  'exists',
  'matches',
  'not_equals',
  'not_exists',
  'starts_with',
])

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key]
  return typeof value === 'boolean' ? value : null
}

function parseConditionRule(value: unknown): FlowConditionRule | null {
  if (!isRecord(value)) return null

  const id = readString(value, 'id')
  const variable = readString(value, 'variable')
  const operator = value.operator
  const targetNodeId = readString(value, 'targetNodeId')
  if (!id || !variable || !targetNodeId || !CONDITION_OPERATORS.has(operator as FlowConditionOperator)) {
    return null
  }

  return {
    id,
    operator: operator as FlowConditionOperator,
    targetNodeId,
    value: readOptionalString(value, 'value'),
    variable,
  }
}

function parseNode(value: unknown): FlowNode | null {
  if (!isRecord(value)) return null

  const id = readString(value, 'id')
  const name = readString(value, 'name')
  const type = value.type
  if (!id || !name || typeof type !== 'string') return null

  if (type === 'agent') {
    const promptTemplate = readString(value, 'promptTemplate')
    const compactOutput = readBoolean(value, 'compactOutput')
    const targetAgentId = value.targetAgentId
    if (!promptTemplate || compactOutput === null) return null
    if (targetAgentId !== null && targetAgentId !== undefined && typeof targetAgentId !== 'string') return null

    return {
      compactOutput,
      id,
      name,
      promptTemplate,
      targetAgentId: typeof targetAgentId === 'string' && targetAgentId.trim() ? targetAgentId.trim() : null,
      type,
    } satisfies AgentFlowNode
  }

  if (type === 'human') {
    const instructions = readString(value, 'instructions')
    const required = readBoolean(value, 'required')
    if (!instructions || required === null) return null

    return {
      id,
      instructions,
      name,
      required,
      type,
    } satisfies HumanFlowNode
  }

  if (type === 'condition') {
    const mode = value.mode
    if (mode !== 'rules' && mode !== 'ai') return null

    const rulesValue = value.rules
    const rules = Array.isArray(rulesValue)
      ? rulesValue.map(parseConditionRule)
      : undefined
    if (rules?.some((rule) => rule === null)) return null

    const evaluatorPrompt = readOptionalString(value, 'evaluatorPrompt')
    if (mode === 'rules' && (!rules || rules.length === 0)) return null
    if (mode === 'ai' && !evaluatorPrompt) return null

    return {
      evaluatorPrompt,
      id,
      mode,
      name,
      rules: rules as FlowConditionRule[] | undefined,
      type,
    } satisfies ConditionFlowNode
  }

  if (type === 'merge') {
    return { id, name, type } satisfies MergeFlowNode
  }

  if (type === 'compaction') {
    const promptTemplate = readString(value, 'promptTemplate')
    if (!promptTemplate) return null

    return { id, name, promptTemplate, type } satisfies CompactionFlowNode
  }

  return null
}

function parseEdge(value: unknown): FlowEdge | null {
  if (!isRecord(value)) return null


  const id = readString(value, 'id')
  const sourceNodeId = readString(value, 'sourceNodeId')
  const targetNodeId = readString(value, 'targetNodeId')
  if (!id || !sourceNodeId || !targetNodeId) return null

  return {
    id,
    label: readOptionalString(value, 'label'),
    sourceNodeId,
    targetNodeId,
  }
}

function parseLayoutNode(value: unknown): FlowLayoutNode | null {
  if (!isRecord(value)) return null

  const nodeId = readString(value, 'nodeId')
  if (!nodeId || typeof value.x !== 'number' || typeof value.y !== 'number') return null

  return { nodeId, x: value.x, y: value.y }
}

function parseLayout(value: unknown): FlowLayout | undefined | null {
  if (value === undefined) return undefined
  if (!isRecord(value) || !Array.isArray(value.nodes)) return null

  const nodes = value.nodes.map(parseLayoutNode)
  if (nodes.some((node) => node === null)) return null

  return { nodes: nodes as FlowLayoutNode[] }
}

function hasCycle(definition: FlowDefinition): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false

    visiting.add(nodeId)
    for (const target of getFlowTraversalTargets(definition, nodeId)) {
      if (visit(target)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }

  return definition.nodes.some((node) => visit(node.id))
}

export function validateFlowDefinition(value: unknown): FlowDefinitionValidationResult {
  if (!isRecord(value) || value.version !== 1) {
    return { ok: false, error: 'invalid_definition_version' }
  }

  const startNodeId = readString(value, 'startNodeId')
  if (!startNodeId || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return { ok: false, error: 'invalid_definition' }
  }

  const nodes = value.nodes.map(parseNode)
  if (nodes.length === 0 || nodes.some((node) => node === null)) {
    return { ok: false, error: 'invalid_flow_nodes' }
  }

  const edges = value.edges.map(parseEdge)
  if (edges.some((edge) => edge === null)) {
    return { ok: false, error: 'invalid_flow_edges' }
  }

  const layout = parseLayout(value.layout)
  if (layout === null) {
    return { ok: false, error: 'invalid_flow_layout' }
  }

  const definition: FlowDefinition = {
    edges: edges as FlowEdge[],
    layout,
    nodes: nodes as FlowNode[],
    startNodeId,
    version: 1,
  }

  const nodeIds = new Set<string>()
  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) {
      return { ok: false, error: 'duplicate_flow_node_id' }
    }
    nodeIds.add(node.id)
  }

  if (!nodeIds.has(definition.startNodeId)) {
    return { ok: false, error: 'unknown_start_node' }
  }

  const edgeIds = new Set<string>()
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) {
      return { ok: false, error: 'duplicate_flow_edge_id' }
    }
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      return { ok: false, error: 'unknown_flow_edge_node' }
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      return { ok: false, error: 'cyclic_flow' }
    }
  }

  for (const node of definition.nodes) {
    if (node.type !== 'condition') continue
    for (const rule of node.rules ?? []) {
      if (!nodeIds.has(rule.targetNodeId)) {
        return { ok: false, error: 'unknown_condition_target' }
      }
    }
  }

  if (definition.layout) {
    for (const node of definition.layout.nodes) {
      if (!nodeIds.has(node.nodeId)) {
        return { ok: false, error: 'unknown_layout_node' }
      }
    }
  }

  if (hasCycle(definition)) {
    return { ok: false, error: 'cyclic_flow' }
  }

  return { ok: true, definition }
}

export function createDefaultFlowDefinition(): FlowDefinition {
  return {
    edges: [],
    layout: {
      nodes: [{ nodeId: 'agent-1', x: 120, y: 120 }],
    },
    nodes: [
      {
        compactOutput: false,
        id: 'agent-1',
        name: 'First agent step',
        promptTemplate: 'Describe what this flow should do.',
        targetAgentId: null,
        type: 'agent',
      },
    ],
    startNodeId: 'agent-1',
    version: 1,
  }
}
