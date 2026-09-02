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

describe('fork topology validation', () => {
  function agentNode(id: string, name: string, promptTemplate = 'Work') {
    return { compactOutput: false, id, name, promptTemplate, targetAgentId: null, type: 'agent' as const }
  }

  function forkNode(id: string, joinNodeId: string, name = 'Fan out') {
    return { id, joinNodeId, name, type: 'fork' as const }
  }

  function createForkDefinition(): FlowDefinition {
    return {
      edges: [
        { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'fork-1' },
        { id: 'edge-2', sourceNodeId: 'fork-1', targetNodeId: 'agent-2' },
        { id: 'edge-3', sourceNodeId: 'fork-1', targetNodeId: 'agent-3' },
        { id: 'edge-4', sourceNodeId: 'agent-2', targetNodeId: 'merge-1' },
        { id: 'edge-5', sourceNodeId: 'agent-3', targetNodeId: 'merge-1' },
      ],
      nodes: [
        agentNode('agent-1', 'Orient'),
        forkNode('fork-1', 'merge-1'),
        agentNode('agent-2', 'Hunt bugs'),
        agentNode('agent-3', 'Hunt perf'),
        { id: 'merge-1', name: 'Collect', type: 'merge' },
      ],
      startNodeId: 'agent-1',
      version: 1,
    }
  }

  it('accepts a well-formed fork/join flow and keeps the join reference', () => {
    const result = validateFlowDefinition(createForkDefinition())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const fork = result.definition.nodes.find((node) => node.id === 'fork-1')
    expect(fork?.type === 'fork' && fork.joinNodeId).toBe('merge-1')
  })

  it('rejects fork nodes without a join reference', () => {
    const cases: unknown[] = [
      { ...forkNode('fork-1', 'merge-1'), joinNodeId: '' },
      { ...forkNode('fork-1', 'merge-1'), joinNodeId: '   ' },
      { id: 'fork-1', name: 'Fan out', type: 'fork' },
    ]

    for (const fork of cases) {
      const definition = createForkDefinition()
      definition.nodes = [fork as FlowDefinition['nodes'][number], ...definition.nodes.slice(1)]
      expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'invalid_flow_nodes' })
    }
  })

  it('rejects non-condition nodes with more than one outgoing edge', () => {
    const definition = createForkDefinition()
    definition.edges.push({ id: 'edge-6', sourceNodeId: 'agent-1', targetNodeId: 'merge-1' })

    expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'multiple_outgoing_edges:agent-1' })
  })

  it('rejects fork joins that are missing or not merge nodes', () => {
    const missing = createForkDefinition()
    missing.nodes[1] = forkNode('fork-1', 'missing')
    expect(validateFlowDefinition(missing)).toEqual({ ok: false, error: 'fork_unknown_join:fork-1' })

    const notMerge = createForkDefinition()
    notMerge.nodes[1] = forkNode('fork-1', 'agent-2')
    expect(validateFlowDefinition(notMerge)).toEqual({ ok: false, error: 'fork_join_not_merge:fork-1' })
  })

  it('rejects two forks declaring the same join', () => {
    const definition = createForkDefinition()
    definition.nodes.push(forkNode('fork-2', 'merge-1', 'Fan out again'))

    expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'fork_join_shared' })
  })

  it('rejects forks with fewer than two branches or a direct fork-to-join edge', () => {
    const single = createForkDefinition()
    single.edges = single.edges.filter((edge) => edge.id !== 'edge-3' && edge.id !== 'edge-5')
    expect(validateFlowDefinition(single)).toEqual({ ok: false, error: 'fork_without_branches:fork-1' })

    const direct = createForkDefinition()
    direct.edges.push({ id: 'edge-6', sourceNodeId: 'fork-1', targetNodeId: 'merge-1' })
    expect(validateFlowDefinition(direct)).toEqual({ ok: false, error: 'fork_branch_empty:fork-1' })
  })

  it('rejects branches that dead-end before reaching the join', () => {
    const deadEnd = createForkDefinition()
    deadEnd.edges = deadEnd.edges.filter((edge) => edge.id !== 'edge-4')
    expect(validateFlowDefinition(deadEnd)).toEqual({ ok: false, error: 'fork_branch_dead_end:agent-2' })
  })

  it('rejects human and slack nodes inside a branch region', () => {
    const definition = createForkDefinition()
    definition.nodes[2] = { id: 'agent-2', instructions: 'Review', name: 'Hunt bugs', required: true, type: 'human' }

    expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'fork_branch_unsupported_node:agent-2' })
  })

  it('rejects join inputs from outside the branch region', () => {
    const definition = createForkDefinition()
    definition.nodes.push(agentNode('agent-4', 'Side chain'))
    definition.edges.push({ id: 'edge-6', sourceNodeId: 'agent-4', targetNodeId: 'merge-1' })

    expect(validateFlowDefinition(definition)).toEqual({ ok: false, error: 'fork_join_external_input:fork-1' })
  })

  it('accepts nested forks with their own joins', () => {
    const definition: FlowDefinition = {
      edges: [
        { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'fork-1' },
        { id: 'edge-2', sourceNodeId: 'fork-1', targetNodeId: 'agent-2' },
        { id: 'edge-3', sourceNodeId: 'fork-1', targetNodeId: 'fork-2' },
        { id: 'edge-4', sourceNodeId: 'agent-2', targetNodeId: 'merge-1' },
        { id: 'edge-5', sourceNodeId: 'fork-2', targetNodeId: 'agent-4' },
        { id: 'edge-6', sourceNodeId: 'fork-2', targetNodeId: 'agent-5' },
        { id: 'edge-7', sourceNodeId: 'agent-4', targetNodeId: 'merge-2' },
        { id: 'edge-8', sourceNodeId: 'agent-5', targetNodeId: 'merge-2' },
        { id: 'edge-9', sourceNodeId: 'merge-2', targetNodeId: 'merge-1' },
      ],
      nodes: [
        agentNode('agent-1', 'Orient'),
        forkNode('fork-1', 'merge-1'),
        agentNode('agent-2', 'Hunt bugs'),
        forkNode('fork-2', 'merge-2', 'Fan out inner'),
        agentNode('agent-4', 'Hunt perf'),
        agentNode('agent-5', 'Hunt improve'),
        { id: 'merge-2', name: 'Collect inner', type: 'merge' },
        { id: 'merge-1', name: 'Collect', type: 'merge' },
      ],
      startNodeId: 'agent-1',
      version: 1,
    }

    expect(validateFlowDefinition(definition).ok).toBe(true)
  })
})
