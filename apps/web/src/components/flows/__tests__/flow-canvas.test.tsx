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
vi.mock('d3-zoom', () => ({
  zoom: vi.fn(() => ({ on: vi.fn().mockReturnThis(), scaleExtent: vi.fn().mockReturnThis() })),
  zoomIdentity: {
    invertX: (value: number) => value,
    invertY: (value: number) => value,
  },
}))

function renderCanvas(overrides?: {
  onAddNodeAfter?: (sourceNodeId: string, type: 'agent' | 'human' | 'condition' | 'slack' | 'merge' | 'compaction') => void
  onConnectNodes?: (sourceNodeId: string, targetNodeId: string) => void
  onEditNode?: (nodeId: string) => void
  onMoveNode?: (nodeId: string, x: number, y: number) => void
  onRemoveConnection?: (edgeId: string) => void
  onSelectNode?: (nodeId: string) => void
}) {
  return render(
    <FlowCanvas
      definition={definition}
      selectedNodeId="agent-1"
      onAddNodeAfter={overrides?.onAddNodeAfter ?? vi.fn()}
      onConnectNodes={overrides?.onConnectNodes ?? vi.fn()}
      onEditNode={overrides?.onEditNode ?? vi.fn()}
      onMoveNode={overrides?.onMoveNode ?? vi.fn()}
      onRemoveConnection={overrides?.onRemoveConnection ?? vi.fn()}
      onSelectNode={overrides?.onSelectNode ?? vi.fn()}
    />,
  )
}

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
    renderCanvas({ onSelectNode })

    expect(screen.getAllByText('Agent step')).toHaveLength(2)
    expect(screen.getAllByText('Human step')).toHaveLength(2)
    expect(screen.getByText('next')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Select Human step' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Select Agent step' }), { key: 'Enter' })

    expect(onSelectNode).toHaveBeenCalledWith('human-1')
    expect(onSelectNode).toHaveBeenCalledWith('agent-1')
  })

  it('edits, adds, connects, and removes nodes through canvas controls', () => {
    const onAddNodeAfter = vi.fn()
    const onConnectNodes = vi.fn()
    const onEditNode = vi.fn()
    const onRemoveConnection = vi.fn()
    renderCanvas({ onAddNodeAfter, onConnectNodes, onEditNode, onRemoveConnection })

    fireEvent.click(screen.getByRole('button', { name: 'Edit Agent step' }))
    expect(onEditNode).toHaveBeenCalledWith('agent-1')

    fireEvent.click(screen.getByRole('button', { name: 'Add node after Agent step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add human step after Agent step' }))
    expect(onAddNodeAfter).toHaveBeenCalledWith('agent-1', 'human')

    fireEvent.click(screen.getByRole('button', { name: 'Add node after Agent step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add slack step after Agent step' }))
    expect(onAddNodeAfter).toHaveBeenCalledWith('agent-1', 'slack')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Connect from Agent step' }), {
      clientX: 166,
      clientY: 48,
      pointerId: 1,
    })
    fireEvent.pointerUp(screen.getByRole('img', { name: 'Flow diagram editor' }), {
      clientX: 230,
      clientY: 48,
      pointerId: 1,
    })
    expect(onConnectNodes).toHaveBeenCalledWith('agent-1', 'human-1')

    fireEvent.click(screen.getByRole('button', { name: 'Remove connection Agent step to Human step' }))
    expect(onRemoveConnection).toHaveBeenCalledWith('edge-1')
  })
})
