import type { FlowDefinition, FlowNode } from '@/lib/flows/types'

export function getFlowNodeById(definition: FlowDefinition, nodeId: string): FlowNode | null {
  return definition.nodes.find((node) => node.id === nodeId) ?? null
}

export function getFlowOutgoingTargets(definition: FlowDefinition, nodeId: string): string[] {
  return definition.edges
    .filter((edge) => edge.sourceNodeId === nodeId)
    .map((edge) => edge.targetNodeId)
}

export function getFlowConditionRuleTargets(node: FlowNode): string[] {
  if (node.type !== 'condition') return []
  if (node.mode !== 'rules') return []

  return (node.rules ?? []).map((rule) => rule.targetNodeId)
}

export function getFlowTraversalTargets(definition: FlowDefinition, nodeId: string): string[] {
  const node = getFlowNodeById(definition, nodeId)
  if (!node) return []

  return Array.from(new Set([
    ...getFlowOutgoingTargets(definition, nodeId),
    ...getFlowConditionRuleTargets(node),
  ]))
}
