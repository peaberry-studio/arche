/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowCanvas } from '@/components/flows/flow-canvas'
import {
  FLOW_ADD_MENU_HEIGHT,
  FLOW_ADD_MENU_MARGIN,
  FLOW_ADD_MENU_WIDTH,
  FLOW_CANVAS_FIT_MAX_SCALE,
  FLOW_CANVAS_FIT_PADDING,
  FLOW_CANVAS_NODE_HEIGHT,
  FLOW_CANVAS_NODE_WIDTH,
  getFlowAddMenuHeight,
  getFlowAddMenuPosition,
  getFlowCanvasContentBounds,
  getFlowCanvasFitTransform,
} from '@/components/flows/flow-canvas-layout'
import { FLOW_CANVAS_NODE_TYPE_OPTIONS } from '@/lib/flows/node-types'
import type { FlowDefinition } from '@/lib/flows/types'

const chain = () => {
  const node: Record<string, unknown> = {}
  node.attr = vi.fn(() => node)
  node.call = vi.fn(() => node)
  node.datum = vi.fn(() => node)
  node.on = vi.fn(() => node)
  node.transition = vi.fn(() => node)
  node.duration = vi.fn(() => node)
  return node
}

vi.mock('d3-selection', () => ({ select: vi.fn(() => chain()) }))
vi.mock('d3-drag', () => ({ drag: vi.fn(() => ({ on: vi.fn().mockReturnThis() })) }))
vi.mock('d3-zoom', () => {
  const behavior = {
    on: vi.fn().mockReturnThis(),
    scaleExtent: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    scaleBy: vi.fn(),
    transform: vi.fn(),
  }
  return {
    zoom: vi.fn(() => behavior),
    zoomIdentity: {
      invertX: (value: number) => value,
      invertY: (value: number) => value,
      scale() {
        return this
      },
      translate() {
        return this
      },
    },
  }
})

function renderCanvas(overrides?: {
  onAddNodeAfter?: (sourceNodeId: string, type: 'agent' | 'human' | 'condition' | 'slack' | 'merge' | 'compaction') => void
  onConnectNodes?: (sourceNodeId: string, targetNodeId: string) => void
  onEditNode?: (nodeId: string) => void
  onMoveNode?: (nodeId: string, x: number, y: number) => void
  onRemoveConnection?: (edgeId: string) => void
  onSelectNode?: (nodeId: string) => void
  slackNodesAvailable?: boolean
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
      slackNodesAvailable={overrides?.slackNodesAvailable}
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

    fireEvent.click(screen.getByRole('button', { name: 'Add node after Agent step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add compaction step after Agent step' }))
    expect(onAddNodeAfter).toHaveBeenCalledWith('agent-1', 'compaction')

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

  it('handles keyboard controls, zoom actions, and expanded escape state', () => {
    const onAddNodeAfter = vi.fn()
    const onEditNode = vi.fn()
    const onRemoveConnection = vi.fn()
    renderCanvas({ onAddNodeAfter, onEditNode, onRemoveConnection })

    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit Agent step' }), { key: 'Tab' })
    expect(onEditNode).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit Agent step' }), { key: 'Enter' })
    expect(onEditNode).toHaveBeenCalledWith('agent-1')

    fireEvent.keyDown(screen.getByRole('button', { name: 'Remove connection Agent step to Human step' }), { key: ' ' })
    expect(onRemoveConnection).toHaveBeenCalledWith('edge-1')

    fireEvent.keyDown(screen.getByRole('button', { name: 'Add node after Agent step' }), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add condition step after Agent step' }), { key: ' ' })
    expect(onAddNodeAfter).toHaveBeenCalledWith('agent-1', 'condition')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))

    fireEvent.click(screen.getByRole('button', { name: 'Maximize canvas' }))
    expect(screen.getByRole('button', { name: 'Minimize canvas' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Maximize canvas' })).toBeTruthy()
  })

  it('tracks pending connections through SVG coordinate transforms', () => {
    const onConnectNodes = vi.fn()
    renderCanvas({ onConnectNodes })

    const svg = screen.getByRole('img', { name: 'Flow diagram editor' })
    const svgWithPointApi = svg as unknown as SVGSVGElement
    const point = {
      x: 0,
      y: 0,
      matrixTransform: () => ({ x: point.x, y: point.y }),
    }
    Object.defineProperty(svgWithPointApi, 'createSVGPoint', { value: () => point })
    Object.defineProperty(svgWithPointApi, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Connect from Agent step' }), {
      clientX: 166,
      clientY: 48,
      pointerId: 1,
    })
    fireEvent.pointerMove(svg, {
      clientX: 230,
      clientY: 48,
      pointerId: 1,
    })
    fireEvent.pointerUp(svg, {
      clientX: 230,
      clientY: 48,
      pointerId: 1,
    })

    expect(onConnectNodes).toHaveBeenCalledWith('agent-1', 'human-1')
  })

  it('renders all add node menu options', () => {
    renderCanvas()

    fireEvent.click(screen.getByRole('button', { name: 'Add node after Agent step' }))

    const menuItems = FLOW_CANVAS_NODE_TYPE_OPTIONS.map((option) => (
      screen.getByRole('button', { name: `Add ${option.label.toLowerCase()} step after Agent step` })
    ))

    expect(screen.getByRole('button', { name: 'Add compaction step after Agent step' })).toBeTruthy()
    expect(menuItems).toHaveLength(FLOW_CANVAS_NODE_TYPE_OPTIONS.length)
  })

  it('hides Slack from add node options when Slack nodes are unavailable', () => {
    renderCanvas({ slackNodesAvailable: false })

    fireEvent.click(screen.getByRole('button', { name: 'Add node after Agent step' }))

    expect(screen.queryByRole('button', { name: 'Add slack step after Agent step' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add agent step after Agent step' })).toBeTruthy()
  })

  it('sizes the add node menu from the available node type options', () => {
    expect(FLOW_ADD_MENU_HEIGHT).toBe(getFlowAddMenuHeight(FLOW_CANVAS_NODE_TYPE_OPTIONS.length))
  })

  it('keeps the add node menu inside visible canvas bounds when possible', () => {
    const position = getFlowAddMenuPosition(
      { x: 260, y: 500 },
      { bottom: 560, left: 0, right: 320, top: 0 },
    )

    expect(position.x).toBeLessThan(0)
    expect(260 + position.x + FLOW_ADD_MENU_WIDTH).toBeLessThanOrEqual(320 - FLOW_ADD_MENU_MARGIN)
    expect(500 + position.y + FLOW_ADD_MENU_HEIGHT).toBeLessThanOrEqual(560 - FLOW_ADD_MENU_MARGIN)
  })

  it('fits content to the viewport without upscaling a small graph', () => {
    const bounds = getFlowCanvasContentBounds([
      { x: 120, y: 120 },
      { x: 350, y: 120 },
    ])

    expect(bounds).toEqual({
      height: FLOW_CANVAS_NODE_HEIGHT,
      maxX: 350 + FLOW_CANVAS_NODE_WIDTH,
      maxY: 120 + FLOW_CANVAS_NODE_HEIGHT,
      minX: 120,
      minY: 120,
      width: 230 + FLOW_CANVAS_NODE_WIDTH,
    })

    const transform = getFlowCanvasFitTransform(bounds!, { height: 560, width: 960 })
    expect(transform?.k).toBe(FLOW_CANVAS_FIT_MAX_SCALE)
    expect(transform?.x).toBe(960 / 2 - ((bounds!.minX + bounds!.maxX) / 2) * FLOW_CANVAS_FIT_MAX_SCALE)
    expect(transform?.y).toBe(560 / 2 - ((bounds!.minY + bounds!.maxY) / 2) * FLOW_CANVAS_FIT_MAX_SCALE)
  })

  it('scales a wide graph down to stay inside the viewport padding', () => {
    const bounds = getFlowCanvasContentBounds([
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
    ])
    const transform = getFlowCanvasFitTransform(bounds!, { height: 560, width: 480 })
    const availableWidth = 480 - FLOW_CANVAS_FIT_PADDING * 2

    expect(transform?.k).toBeCloseTo(availableWidth / bounds!.width)
    expect(transform!.k).toBeLessThan(1)
  })

  it('skips fitting when the graph or viewport has no size', () => {
    expect(getFlowCanvasContentBounds([])).toBeNull()
    expect(getFlowCanvasFitTransform(
      { height: 56, maxX: 156, maxY: 56, minX: 0, minY: 0, width: 156 },
      { height: 0, width: 400 },
    )).toBeNull()
  })
})
