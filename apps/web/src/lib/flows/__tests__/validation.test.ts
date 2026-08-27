import { describe, expect, it } from 'vitest'

import type { FlowDefinition } from '@/lib/flows/types'
import { createDefaultFlowDefinition, validateFlowDefinition } from '@/lib/flows/validation'

describe('validateFlowDefinition', () => {
  it('accepts the default flow definition', () => {
    expect(validateFlowDefinition(createDefaultFlowDefinition()).ok).toBe(true)
  })

  it('rejects malformed nodes, edges, and layout metadata', () => {
    const base = createDefaultFlowDefinition()

    const cases = [
      {
        error: 'invalid_flow_nodes',
        input: {
          ...base,
          nodes: [{ id: 'custom-1', name: 'Custom', type: 'custom' }],
          startNodeId: 'custom-1',
        },
      },
      {
        error: 'invalid_flow_nodes',
        input: {
          ...base,
          nodes: [
            {
              id: 'condition-1',
              mode: 'rules',
              name: 'Condition',
              rules: [{ id: 'rule-1', operator: 'unknown', targetNodeId: 'agent-1', variable: 'previous.output' }],
              type: 'condition',
            },
            base.nodes[0],
          ],
          startNodeId: 'condition-1',
        },
      },
      {
        error: 'invalid_flow_nodes',
        input: {
          ...base,
          nodes: [{ id: 'slack-1', messageMode: 'fixed', messageTemplate: 'Hi', name: 'Notify', target: { type: 'group' }, type: 'slack' }],
          startNodeId: 'slack-1',
        },
      },
      {
        error: 'invalid_flow_edges',
        input: { ...base, edges: [{ id: 'edge-1', sourceNodeId: 'agent-1' }] },
      },
      {
        error: 'invalid_flow_layout',
        input: { ...base, layout: { nodes: [{ nodeId: 'agent-1', x: 'bad', y: 0 }] } },
      },
    ]

    for (const testCase of cases) {
      expect(validateFlowDefinition(testCase.input)).toEqual({ ok: false, error: testCase.error })
    }
  })

  it('rejects duplicate and unknown graph references', () => {
    const base = createDefaultFlowDefinition()
    const secondAgent = {
      compactOutput: false,
      id: 'agent-2',
      name: 'Second agent step',
      promptTemplate: 'Continue',
      targetAgentId: null,
      type: 'agent',
    }

    const cases = [
      {
        error: 'duplicate_flow_node_id',
        input: { ...base, nodes: [base.nodes[0], { ...secondAgent, id: 'agent-1' }] },
      },
      {
        error: 'unknown_start_node',
        input: { ...base, startNodeId: 'missing' },
      },
      {
        error: 'duplicate_flow_edge_id',
        input: {
          ...base,
          edges: [
            { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'agent-2' },
            { id: 'edge-1', sourceNodeId: 'agent-2', targetNodeId: 'agent-1' },
          ],
          nodes: [base.nodes[0], secondAgent],
        },
      },
      {
        error: 'unknown_flow_edge_node',
        input: { ...base, edges: [{ id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'missing' }] },
      },
      {
        error: 'cyclic_flow',
        input: { ...base, edges: [{ id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'agent-1' }] },
      },
    ]

    for (const testCase of cases) {
      expect(validateFlowDefinition(testCase.input)).toEqual({ ok: false, error: testCase.error })
    }
  })

  it('rejects cycles created by condition rule targets through graph edges', () => {
    const definition: FlowDefinition = {
      edges: [
        { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'condition-1' },
        { id: 'edge-2', sourceNodeId: 'condition-1', targetNodeId: 'agent-1' },
      ],
      nodes: [
        {
          compactOutput: false,
          id: 'agent-1',
          name: 'Agent',
          promptTemplate: 'Start',
          targetAgentId: null,
          type: 'agent',
        },
        {
          id: 'condition-1',
          mode: 'rules',
          name: 'Condition',
          rules: [{ id: 'rule-1', operator: 'exists', targetNodeId: 'agent-1', variable: 'previous.output' }],
          type: 'condition',
        },
      ],
      startNodeId: 'agent-1',
      version: 1,
    }

    expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'cyclic_flow' })
  })

  it('rejects condition rules targeting their own node', () => {
    const definition: FlowDefinition = {
      edges: [],
      nodes: [
        {
          id: 'condition-1',
          mode: 'rules',
          name: 'Condition',
          rules: [{ id: 'rule-1', operator: 'exists', targetNodeId: 'condition-1', variable: 'previous.output' }],
          type: 'condition',
        },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }

    expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'cyclic_flow' })
  })

  it('rejects condition rules targeting missing nodes', () => {
    const definition: FlowDefinition = {
      edges: [],
      nodes: [
        {
          id: 'condition-1',
          mode: 'rules',
          name: 'Condition',
          rules: [{ id: 'rule-1', operator: 'exists', targetNodeId: 'missing', variable: 'previous.output' }],
          type: 'condition',
        },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }

    expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'unknown_condition_target' })
  })

  it('adds missing outgoing edges for condition rule targets', () => {
    const definition: FlowDefinition = {
      edges: [],
      nodes: [
        {
          id: 'condition-1',
          mode: 'rules',
          name: 'Condition',
          rules: [{ id: 'rule-1', operator: 'exists', targetNodeId: 'merge-1', variable: 'previous.output' }],
          type: 'condition',
        },
        { id: 'merge-1', name: 'Merge', type: 'merge' },
      ],
      startNodeId: 'condition-1',
      version: 1,
    }

    const result = validateFlowDefinition(definition)

    expect(result).toEqual({
      ok: true,
      definition: expect.objectContaining({
        edges: [expect.objectContaining({ sourceNodeId: 'condition-1', targetNodeId: 'merge-1' })],
      }),
    })
  })

  it('accepts configured Slack message nodes and rejects incomplete ones', () => {
    const definition: FlowDefinition = {
      edges: [],
      nodes: [{ id: 'slack-1', messageMode: 'template', messageTemplate: 'Report: {{previous.output}}', name: 'Notify', target: { type: 'channel', channelId: 'C1' }, type: 'slack' }],
      startNodeId: 'slack-1',
      version: 1,
    }

    expect(validateFlowDefinition(definition).ok).toBe(true)
    expect(validateFlowDefinition({
      ...definition,
      nodes: [{ ...definition.nodes[0], target: { type: 'dm', userId: '' } }],
    })).toEqual({ ok: false, error: 'invalid_flow_nodes' })
    expect(validateFlowDefinition({
      ...definition,
      nodes: [{ ...definition.nodes[0], messageMode: 'fixed', messageTemplate: '' }],
    })).toEqual({ ok: false, error: 'invalid_flow_nodes' })
  })

  it('accepts agent steps without connector declarations and normalizes valid lists', () => {
    const base = createDefaultFlowDefinition()

    const absent = validateFlowDefinition(base)
    expect(absent.ok).toBe(true)
    if (!absent.ok) return
    expect(absent.definition.nodes[0]).not.toHaveProperty('requiredConnectors')

    const result = validateFlowDefinition({
      ...base,
      nodes: [{ ...base.nodes[0], requiredConnectors: [' c1 ', 'c2', 'c1'] }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const agentNode = result.definition.nodes[0]
    expect(agentNode.type === 'agent' && agentNode.requiredConnectors).toEqual(['c1', 'c2'])
  })

  it('rejects malformed connector declarations', () => {
    const base = createDefaultFlowDefinition()
    const cases: unknown[] = [
      'a plain string',
      { notAnArray: true },
      [42],
      [null],
      [''],
      ['   '],
      ['ok', ''],
    ]

    for (const requiredConnectors of cases) {
      expect(validateFlowDefinition({
        ...base,
        nodes: [{ ...base.nodes[0], requiredConnectors }],
      })).toEqual({ ok: false, error: 'invalid_flow_nodes' })
    }
  })
})
