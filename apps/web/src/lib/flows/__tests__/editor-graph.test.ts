import { describe, expect, it, vi } from 'vitest'

import {
  addFlowDefinitionNodeAfter,
  connectFlowDefinitionNodes,
  createFlowEditorNode,
  deleteFlowDefinitionNode,
  getUniqueFlowNodeId,
  moveFlowDefinitionNode,
  removeFlowDefinitionConnection,
  updateFlowDefinitionNode,
} from '@/lib/flows/editor-graph'
import type { FlowDefinition, FlowNode } from '@/lib/flows/types'

function definition(): FlowDefinition {
  return {
    edges: [{ id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'human-1' }],
    layout: {
      nodes: [
        { nodeId: 'agent-1', x: 100, y: 100 },
        { nodeId: 'human-1', x: 400, y: 100 },
      ],
    },
    nodes: [
      {
        compactOutput: false,
        id: 'agent-1',
        name: 'Agent',
        promptTemplate: 'Send {{steps.human-1.output}} and {{human.human-1.response}}',
        targetAgentId: null,
        type: 'agent',
      },
      {
        id: 'human-1',
        instructions: 'Review {{steps.agent-1.output}}',
        name: 'Human',
        required: true,
        type: 'human',
      },
    ],
    startNodeId: 'agent-1',
    version: 1,
  }
}

describe('flow editor graph helpers', () => {
  it('creates unique semantic node ids and default nodes', () => {
    expect(getUniqueFlowNodeId('Réview plan', 'human', new Set(['review-plan']))).toBe('review-plan-2')
    expect(getUniqueFlowNodeId('!!!', 'agent', new Set(['agent-step']))).toBe('agent-step-2')
    expect(createFlowEditorNode('agent', 1, new Set())).toMatchObject({
      compactOutput: false,
      id: 'agent-step-1',
      promptTemplate: 'Use {{previous.output}} if this is not the first step.',
      targetAgentId: null,
      type: 'agent',
    })
    expect(createFlowEditorNode('human', 2, new Set())).toMatchObject({
      id: 'human-step-2',
      required: true,
      type: 'human',
    })
    expect(createFlowEditorNode('condition', 2, new Set())).toMatchObject({
      id: 'condition-2',
      mode: 'rules',
      rules: [],
      type: 'condition',
    })
    expect(createFlowEditorNode('slack', 3, new Set())).toMatchObject({
      id: 'slack-message-3',
      messageMode: 'fixed',
      type: 'slack',
    })
    expect(createFlowEditorNode('merge', 4, new Set())).toMatchObject({ id: 'merge-4', type: 'merge' })
  })

  it('renames nodes while preserving edges, layout, start node, and template references', () => {
    const renamedHuman: FlowNode = {
      id: 'human-1',
      instructions: 'Review {{steps.agent-1.output}}',
      name: 'Approval Step',
      required: true,
      type: 'human',
    }

    const result = updateFlowDefinitionNode(definition(), renamedHuman)

    expect(result?.nodeId).toBe('approval-step')
    expect(result?.definition.startNodeId).toBe('agent-1')
    expect(result?.definition.edges).toEqual([{ id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'approval-step' }])
    expect(result?.definition.layout?.nodes).toContainEqual({ nodeId: 'approval-step', x: 400, y: 100 })
    expect(result?.definition.nodes[0]).toMatchObject({
      promptTemplate: 'Send {{steps.approval-step.output}} and {{human.approval-step.response}}',
    })
  })

  it('renames condition targets and template references across node types', () => {
    const flow: FlowDefinition = {
      edges: [
        { id: 'edge-1', sourceNodeId: 'review.node', targetNodeId: 'condition-1' },
        { id: 'edge-2', sourceNodeId: 'condition-1', targetNodeId: 'slack-1' },
      ],
      layout: undefined,
      nodes: [
        {
          id: 'review.node',
          instructions: 'Review {{steps.review.node.output}}',
          name: 'Review Node',
          required: true,
          type: 'human',
        },
        {
          evaluatorPrompt: 'Evaluate {{human.review.node.response}}',
          id: 'condition-1',
          mode: 'rules',
          name: 'Condition',
          rules: [
            { id: 'rule-1', operator: 'contains', targetNodeId: 'review.node', value: 'yes', variable: '{{steps.review.node.output}}' },
          ],
          type: 'condition',
        },
        {
          id: 'slack-1',
          messageMode: 'fixed',
          messageTemplate: 'Notify {{steps.review.node.output}}',
          name: 'Slack',
          target: { type: 'dm', userId: 'U1' },
          type: 'slack',
        },
        {
          id: 'compact-1',
          name: 'Compact',
          promptTemplate: 'Compact {{steps.review.node.output}}',
          type: 'compaction',
        },
      ],
      startNodeId: 'review.node',
      version: 1,
    }

    const result = updateFlowDefinitionNode(flow, {
      id: 'review.node',
      instructions: 'Review {{steps.review.node.output}}',
      name: 'Final Review',
      required: true,
      type: 'human',
    })

    expect(result?.nodeId).toBe('final-review')
    expect(result?.definition.startNodeId).toBe('final-review')
    expect(result?.definition.edges[0]).toEqual({ id: 'edge-1', sourceNodeId: 'final-review', targetNodeId: 'condition-1' })
    expect(result?.definition.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ instructions: 'Review {{steps.final-review.output}}' }),
      expect.objectContaining({
        evaluatorPrompt: 'Evaluate {{human.final-review.response}}',
        rules: [expect.objectContaining({
          targetNodeId: 'final-review',
          variable: '{{steps.final-review.output}}',
        })],
      }),
      expect.objectContaining({ messageTemplate: 'Notify {{steps.final-review.output}}' }),
      expect.objectContaining({ promptTemplate: 'Compact {{steps.final-review.output}}' }),
    ]))
  })

  it('moves, deletes, connects, and removes graph elements', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123)
    const moved = moveFlowDefinitionNode(definition(), 'agent-1', 150, 160)
    expect(moved.layout?.nodes).toContainEqual({ nodeId: 'agent-1', x: 150, y: 160 })

    const withLooseLayout = moveFlowDefinitionNode(moved, 'loose', 10, 20)
    expect(withLooseLayout.layout?.nodes).toContainEqual({ nodeId: 'loose', x: 10, y: 20 })

    const inserted = addFlowDefinitionNodeAfter(definition(), 'agent-1', 'compaction', 'new')
    expect(inserted?.node).toMatchObject({ id: 'compaction-3', type: 'compaction' })
    expect(inserted?.definition.edges).toEqual([
      { id: 'edge-new', sourceNodeId: 'agent-1', targetNodeId: 'compaction-3' },
      { id: 'edge-new-next', sourceNodeId: 'compaction-3', targetNodeId: 'human-1' },
    ])

    const connected = connectFlowDefinitionNodes(definition(), 'agent-1', 'human-1', 'manual-edge')
    expect(connected?.edges).toEqual([{ id: 'manual-edge', sourceNodeId: 'agent-1', targetNodeId: 'human-1' }])
    expect(connectFlowDefinitionNodes(definition(), 'agent-1', 'agent-1')).toBeNull()

    const removed = removeFlowDefinitionConnection(definition(), 'edge-1')
    expect(removed.edges).toEqual([])

    const deleted = deleteFlowDefinitionNode(definition(), 'agent-1')
    expect(deleted).toMatchObject({ edges: [], startNodeId: 'human-1' })
    expect(deleteFlowDefinitionNode(deleted!, 'human-1')).toBeNull()
  })

  it('handles condition insert/connect semantics and missing graph references', () => {
    const conditionFlow: FlowDefinition = {
      ...definition(),
      edges: [{ id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'human-1' }],
      layout: undefined,
      nodes: [
        {
          id: 'condition-1',
          mode: 'rules',
          name: 'Condition',
          rules: [],
          type: 'condition',
        },
        ...definition().nodes,
      ],
      startNodeId: 'condition-1',
    }

    expect(updateFlowDefinitionNode(conditionFlow, {
      compactOutput: false,
      id: 'missing',
      name: 'Missing',
      promptTemplate: '',
      targetAgentId: null,
      type: 'agent',
    })).toBeNull()
    expect(addFlowDefinitionNodeAfter(conditionFlow, 'missing', 'agent')).toBeNull()
    expect(connectFlowDefinitionNodes(conditionFlow, 'missing', 'human-1')).toBeNull()

    const inserted = addFlowDefinitionNodeAfter(conditionFlow, 'condition-1', 'agent', 'condition')
    expect(inserted?.definition.edges).toEqual([
      { id: 'edge-1', sourceNodeId: 'condition-1', targetNodeId: 'human-1' },
      { id: 'edge-condition', sourceNodeId: 'condition-1', targetNodeId: 'agent-step-4' },
    ])
    expect(inserted?.definition.layout?.nodes).toContainEqual({ nodeId: 'agent-step-4', x: 350, y: 120 })

    const connected = connectFlowDefinitionNodes(conditionFlow, 'condition-1', 'human-1', 'edge-2')
    expect(connected?.edges).toEqual([{ id: 'edge-2', sourceNodeId: 'condition-1', targetNodeId: 'human-1' }])
  })
})
