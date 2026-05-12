/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowNodeInspector } from '@/components/flows/flow-node-inspector'
import type { FlowDefinition } from '@/lib/flows/types'

const definition: FlowDefinition = {
  edges: [],
  nodes: [
    { compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Prompt', targetAgentId: null, type: 'agent' },
    { id: 'human-1', instructions: 'Review', name: 'Human', required: true, type: 'human' },
    { id: 'condition-1', mode: 'rules', name: 'Condition', rules: [{ id: 'rule-1', operator: 'contains', targetNodeId: 'human-1', value: 'yes', variable: 'previous.output' }], type: 'condition' },
    { id: 'merge-1', name: 'Merge', type: 'merge' },
  ],
  startNodeId: 'agent-1',
  version: 1,
}

describe('FlowNodeInspector', () => {
  afterEach(() => cleanup())

  it('renders an empty selection message', () => {
    render(<FlowNodeInspector agents={[]} definition={definition} selectedNode={null} onDeleteNode={vi.fn()} onUpdateDefinition={vi.fn()} onUpdateNode={vi.fn()} />)

    expect(screen.getByText('Select a node to edit its properties.')).toBeTruthy()
  })

  it('updates agent properties and outgoing target', () => {
    const onUpdateNode = vi.fn()
    const onUpdateDefinition = vi.fn()
    render(
      <FlowNodeInspector
        agents={[{ displayName: 'Writer', id: 'writer', isPrimary: false, usesDefaultModel: true }]}
        definition={definition}
        selectedNode={definition.nodes[0]}
        onDeleteNode={vi.fn()}
        onUpdateDefinition={onUpdateDefinition}
        onUpdateNode={onUpdateNode}
      />,
    )

    fireEvent.change(screen.getByLabelText('Target agent'), { target: { value: 'writer' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ targetAgentId: 'writer' }))

    fireEvent.change(screen.getByLabelText('Next node'), { target: { value: 'human-1' } })
    expect(onUpdateDefinition).toHaveBeenCalledWith(expect.objectContaining({
      edges: [expect.objectContaining({ sourceNodeId: 'agent-1', targetNodeId: 'human-1' })],
    }))
  })

  it('updates condition rules and mode', () => {
    const onUpdateNode = vi.fn()
    render(<FlowNodeInspector agents={[]} definition={definition} selectedNode={definition.nodes[2]} onDeleteNode={vi.fn()} onUpdateDefinition={vi.fn()} onUpdateNode={onUpdateNode} />)

    fireEvent.change(screen.getByDisplayValue('previous.output'), { target: { value: 'flow.name' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.objectContaining({ variable: 'flow.name' })],
    }))

    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'ai' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ai' }))
  })

  it('documents merge nodes as pass-through markers', () => {
    render(<FlowNodeInspector agents={[]} definition={definition} selectedNode={definition.nodes[3]} onDeleteNode={vi.fn()} onUpdateDefinition={vi.fn()} onUpdateNode={vi.fn()} />)

    expect(screen.getByText(/Merge nodes are pass-through join markers/)).toBeTruthy()
  })
})
