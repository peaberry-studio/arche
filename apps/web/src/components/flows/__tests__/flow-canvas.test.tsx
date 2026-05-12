/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowCanvas } from '@/components/flows/flow-canvas'
import type { FlowDefinition } from '@/lib/flows/types'

const chain = () => ({
  attr: vi.fn().mockReturnThis(),
  call: vi.fn().mockReturnThis(),
  datum: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
})

vi.mock('d3-selection', () => ({ select: vi.fn(() => chain()) }))
vi.mock('d3-drag', () => ({ drag: vi.fn(() => ({ on: vi.fn().mockReturnThis() })) }))
vi.mock('d3-zoom', () => ({ zoom: vi.fn(() => ({ on: vi.fn().mockReturnThis(), scaleExtent: vi.fn().mockReturnThis() })) }))

const definition: FlowDefinition = {
  edges: [{ id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'human-1', label: 'next' }],
  layout: { nodes: [{ nodeId: 'agent-1', x: 10, y: 20 }, { nodeId: 'human-1', x: 220, y: 20 }] },
  nodes: [
    { compactOutput: false, id: 'agent-1', name: 'Agent step', promptTemplate: 'Prompt', targetAgentId: null, type: 'agent' },
    { id: 'human-1', instructions: 'Review', name: 'Human step', required: true, type: 'human' },
  ],
  startNodeId: 'agent-1',
  version: 1,
}

describe('FlowCanvas', () => {
  afterEach(() => cleanup())

  it('renders nodes and selects them with mouse and keyboard', () => {
    const onSelectNode = vi.fn()
    render(<FlowCanvas definition={definition} selectedNodeId="agent-1" onMoveNode={vi.fn()} onSelectNode={onSelectNode} />)

    expect(screen.getAllByText('Agent step')).toHaveLength(2)
    expect(screen.getAllByText('Human step')).toHaveLength(2)
    expect(screen.getByText('next')).toBeTruthy()

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1])
    fireEvent.keyDown(buttons[0], { key: 'Enter' })

    expect(onSelectNode).toHaveBeenCalledWith('human-1')
    expect(onSelectNode).toHaveBeenCalledWith('agent-1')
  })
})
