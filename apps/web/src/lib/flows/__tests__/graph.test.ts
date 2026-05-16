import { describe, expect, it } from 'vitest'

import { getFlowNodeById, getFlowOutgoingTargets, getFlowTraversalTargets } from '@/lib/flows/graph'
import type { FlowDefinition } from '@/lib/flows/types'

const definition: FlowDefinition = {
  edges: [
    { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'merge-1' },
    { id: 'edge-2', sourceNodeId: 'condition-1', targetNodeId: 'merge-1' },
  ],
  nodes: [
    {
      compactOutput: false,
      id: 'agent-1',
      name: 'Agent',
      promptTemplate: 'Prompt',
      targetAgentId: null,
      type: 'agent',
    },
    {
      id: 'condition-1',
      mode: 'rules',
      name: 'Condition',
      rules: [{ id: 'rule-1', operator: 'contains', targetNodeId: 'agent-1', value: 'yes', variable: 'previous.output' }],
      type: 'condition',
    },
    { id: 'merge-1', name: 'Merge', type: 'merge' },
  ],
  startNodeId: 'agent-1',
  version: 1,
}

describe('flow graph helpers', () => {
  it('finds nodes and outgoing edges', () => {
    expect(getFlowNodeById(definition, 'agent-1')?.name).toBe('Agent')
    expect(getFlowOutgoingTargets(definition, 'agent-1')).toEqual(['merge-1'])
  })

  it('uses outgoing edges as traversal targets', () => {
    expect(getFlowTraversalTargets(definition, 'condition-1')).toEqual(['merge-1'])
  })
})
