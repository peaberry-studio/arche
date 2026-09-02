import type { FlowDefinition, FlowNode } from '@/lib/flows/types'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function slugifyNodeId(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getUniqueFlowNodeId(name: string, type: FlowNode['type'], existingIds: ReadonlySet<string>): string {
  const base = slugifyNodeId(name) || `${type}-step`
  let candidate = base
  let suffix = 2

  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }

  return candidate
}

function replaceNodeVariableReferences(value: string, previousId: string, nextId: string): string {
  if (previousId === nextId) return value

  const escapedId = escapeRegExp(previousId)
  return value
    .replace(new RegExp(`steps\\.${escapedId}\\.output`, 'g'), `steps.${nextId}.output`)
    .replace(new RegExp(`human\\.${escapedId}\\.response`, 'g'), `human.${nextId}.response`)
}

function updateNodeReferences(node: FlowNode, previousId: string, nextId: string): FlowNode {
  if (previousId === nextId) return node

  if (node.type === 'agent') {
    return { ...node, promptTemplate: replaceNodeVariableReferences(node.promptTemplate, previousId, nextId) }
  }

  if (node.type === 'human') {
    return { ...node, instructions: replaceNodeVariableReferences(node.instructions, previousId, nextId) }
  }

  if (node.type === 'condition') {
    return {
      ...node,
      evaluatorPrompt: node.evaluatorPrompt
        ? replaceNodeVariableReferences(node.evaluatorPrompt, previousId, nextId)
        : node.evaluatorPrompt,
      rules: node.rules?.map((rule) => ({
        ...rule,
        targetNodeId: rule.targetNodeId === previousId ? nextId : rule.targetNodeId,
        variable: replaceNodeVariableReferences(rule.variable, previousId, nextId),
      })),
    }
  }

  if (node.type === 'slack') {
    return { ...node, messageTemplate: replaceNodeVariableReferences(node.messageTemplate, previousId, nextId) }
  }

  if (node.type === 'compaction') {
    return { ...node, promptTemplate: replaceNodeVariableReferences(node.promptTemplate, previousId, nextId) }
  }

  if (node.type === 'fork') {
    return { ...node, joinNodeId: node.joinNodeId === previousId ? nextId : node.joinNodeId }
  }

  return node
}

export function createFlowEditorNode(type: FlowNode['type'], index: number, existingIds: ReadonlySet<string>): FlowNode {
  if (type === 'agent') {
    const name = `Agent step ${index}`
    return {
      compactOutput: false,
      id: getUniqueFlowNodeId(name, type, existingIds),
      name,
      promptTemplate: 'Use {{previous.output}} if this is not the first step.',
      targetAgentId: null,
      type,
    }
  }

  if (type === 'human') {
    const name = `Human step ${index}`
    return {
      id: getUniqueFlowNodeId(name, type, existingIds),
      instructions: 'Review the current flow output and provide the next instruction.',
      name,
      required: true,
      type,
    }
  }

  if (type === 'condition') {
    const name = `Condition ${index}`
    return {
      id: getUniqueFlowNodeId(name, type, existingIds),
      mode: 'rules',
      name,
      rules: [],
      type,
    }
  }

  if (type === 'slack') {
    const name = `Slack message ${index}`
    return {
      id: getUniqueFlowNodeId(name, type, existingIds),
      messageMode: 'fixed',
      messageTemplate: 'Flow update',
      name,
      target: { type: 'dm', userId: '' },
      type,
    }
  }

  if (type === 'compaction') {
    const name = `Compaction ${index}`
    return {
      id: getUniqueFlowNodeId(name, type, existingIds),
      name,
      promptTemplate: 'Compact {{previous.output}} for later steps.',
      type,
    }
  }

  const name = `Merge ${index}`
  return {
    id: getUniqueFlowNodeId(name, type, existingIds),
    name,
    type,
  }
}

export function updateFlowDefinitionNode(definition: FlowDefinition, node: FlowNode): { definition: FlowDefinition; nodeId: string } | null {
  const previousNode = definition.nodes.find((candidate) => candidate.id === node.id)
  if (!previousNode) return null

  const existingIds = new Set(definition.nodes
    .filter((candidate) => candidate.id !== previousNode.id)
    .map((candidate) => candidate.id))
  const nextNodeId = previousNode.name !== node.name
    ? getUniqueFlowNodeId(node.name, node.type, existingIds)
    : node.id
  const nextNode = nextNodeId === node.id ? node : { ...node, id: nextNodeId } as FlowNode

  return {
    definition: {
      ...definition,
      edges: definition.edges.map((edge) => ({
        ...edge,
        sourceNodeId: edge.sourceNodeId === previousNode.id ? nextNodeId : edge.sourceNodeId,
        targetNodeId: edge.targetNodeId === previousNode.id ? nextNodeId : edge.targetNodeId,
      })),
      layout: definition.layout
        ? {
            nodes: definition.layout.nodes.map((layoutNode) => ({
              ...layoutNode,
              nodeId: layoutNode.nodeId === previousNode.id ? nextNodeId : layoutNode.nodeId,
            })),
          }
        : definition.layout,
      nodes: definition.nodes.map((candidate) => (
        candidate.id === previousNode.id
          ? updateNodeReferences(nextNode, previousNode.id, nextNodeId)
          : updateNodeReferences(candidate, previousNode.id, nextNodeId)
      )),
      startNodeId: definition.startNodeId === previousNode.id ? nextNodeId : definition.startNodeId,
    },
    nodeId: nextNodeId,
  }
}

export function deleteFlowDefinitionNode(definition: FlowDefinition, nodeId: string): FlowDefinition | null {
  const nextNodes = definition.nodes.filter((node) => node.id !== nodeId)
  if (nextNodes.length === 0) return null

  return {
    ...definition,
    edges: definition.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
    layout: {
      nodes: (definition.layout?.nodes ?? []).filter((node) => node.nodeId !== nodeId),
    },
    nodes: nextNodes,
    startNodeId: definition.startNodeId === nodeId ? nextNodes[0].id : definition.startNodeId,
  }
}

export function moveFlowDefinitionNode(definition: FlowDefinition, nodeId: string, x: number, y: number): FlowDefinition {
  const layoutNodes = definition.layout?.nodes ?? []
  const exists = layoutNodes.some((node) => node.nodeId === nodeId)
  return {
    ...definition,
    layout: {
      nodes: exists
        ? layoutNodes.map((node) => node.nodeId === nodeId ? { ...node, x, y } : node)
        : [...layoutNodes, { nodeId, x, y }],
    },
  }
}

export function addFlowDefinitionNodeAfter(
  definition: FlowDefinition,
  sourceNodeId: string,
  type: FlowNode['type'],
  edgeBase: number | string = Date.now(),
): { definition: FlowDefinition; node: FlowNode } | null {
  const sourceNode = definition.nodes.find((node) => node.id === sourceNodeId)
  if (!sourceNode) return null

  const sourceIndex = definition.nodes.findIndex((node) => node.id === sourceNodeId)
  const sourceLayout = definition.layout?.nodes.find((node) => node.nodeId === sourceNodeId)
  const node = createFlowEditorNode(type, definition.nodes.length + 1, new Set(definition.nodes.map((node) => node.id)))
  const existingOutgoing = definition.edges.filter((edge) => edge.sourceNodeId === sourceNodeId)
  const retainedEdges = sourceNode.type === 'condition'
    ? definition.edges
    : definition.edges.filter((edge) => edge.sourceNodeId !== sourceNodeId)
  const insertedEdges = [
    ...retainedEdges,
    { id: `edge-${edgeBase}`, sourceNodeId, targetNodeId: node.id },
  ]
  const bridgedEdges = sourceNode.type !== 'condition' && existingOutgoing[0]
    ? [
        ...insertedEdges,
        { id: `edge-${edgeBase}-next`, sourceNodeId: node.id, targetNodeId: existingOutgoing[0].targetNodeId },
      ]
    : insertedEdges

  return {
    definition: {
      ...definition,
      edges: bridgedEdges,
      layout: {
        nodes: [
          ...(definition.layout?.nodes ?? []),
          {
            nodeId: node.id,
            x: (sourceLayout?.x ?? 120 + sourceIndex * 190) + 230,
            y: sourceLayout?.y ?? 120,
          },
        ],
      },
      nodes: [...definition.nodes, node],
    },
    node,
  }
}

export function connectFlowDefinitionNodes(
  definition: FlowDefinition,
  sourceNodeId: string,
  targetNodeId: string,
  edgeId = `edge-${Date.now()}`,
): FlowDefinition | null {
  if (sourceNodeId === targetNodeId) return null

  const sourceNode = definition.nodes.find((node) => node.id === sourceNodeId)
  const targetNode = definition.nodes.find((node) => node.id === targetNodeId)
  if (!sourceNode || !targetNode) return null

  const retainedEdges = sourceNode.type === 'condition'
    ? definition.edges.filter((edge) => edge.sourceNodeId !== sourceNodeId || edge.targetNodeId !== targetNodeId)
    : definition.edges.filter((edge) => edge.sourceNodeId !== sourceNodeId)

  return {
    ...definition,
    edges: [
      ...retainedEdges,
      { id: edgeId, sourceNodeId, targetNodeId },
    ],
  }
}

export function removeFlowDefinitionConnection(definition: FlowDefinition, edgeId: string): FlowDefinition {
  return { ...definition, edges: definition.edges.filter((edge) => edge.id !== edgeId) }
}
