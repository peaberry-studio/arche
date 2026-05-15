import { describe, expect, it } from 'vitest'

import type { FlowDefinition } from '@/lib/flows/types'
import { createDefaultFlowDefinition, validateFlowDefinition } from '@/lib/flows/validation'

describe('validateFlowDefinition', () => {
  it('accepts the default flow definition', () => {
    expect(validateFlowDefinition(createDefaultFlowDefinition()).ok).toBe(true)
  })

  it('rejects cycles created by condition rule targets', () => {
    const definition: FlowDefinition = {
      edges: [{ id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'condition-1' }],
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
})
