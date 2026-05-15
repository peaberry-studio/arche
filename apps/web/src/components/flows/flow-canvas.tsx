'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type TouchEvent } from 'react'
import { drag as d3drag } from 'd3-drag'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom'

import type { FlowDefinition, FlowLayoutNode, FlowNodeType } from '@/lib/flows/types'
import { cn } from '@/lib/utils'

type FlowCanvasProps = {
  definition: FlowDefinition
  selectedNodeId: string | null
  onAddNodeAfter: (sourceNodeId: string, type: FlowNodeType) => void
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void
  onEditNode: (nodeId: string) => void
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onRemoveConnection: (edgeId: string) => void
  onSelectNode: (nodeId: string) => void
}

type CanvasNode = FlowLayoutNode & {
  label: string
  type: string
}

const NODE_WIDTH = 156
const NODE_HEIGHT = 56
const ADD_NODE_TYPES: Array<{ label: string; type: FlowNodeType }> = [
  { label: 'Agent', type: 'agent' },
  { label: 'Human', type: 'human' },
  { label: 'Condition', type: 'condition' },
  { label: 'Slack', type: 'slack' },
  { label: 'Merge', type: 'merge' },
]

type PendingConnection = {
  sourceNodeId: string
  x: number
  y: number
}

function stopCanvasAction(event: MouseEvent<SVGGElement> | PointerEvent<SVGGElement> | TouchEvent<SVGGElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export function FlowCanvas({
  definition,
  selectedNodeId,
  onAddNodeAfter,
  onConnectNodes,
  onEditNode,
  onMoveNode,
  onRemoveConnection,
  onSelectNode,
}: FlowCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const zoomLayerRef = useRef<SVGGElement | null>(null)
  const zoomTransformRef = useRef<ZoomTransform>(zoomIdentity)
  const nodeRefs = useRef<Map<string, SVGGElement>>(new Map())
  const [addMenuNodeId, setAddMenuNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)

  const nodes = useMemo<CanvasNode[]>(() => {
    const layoutByNodeId = new Map(definition.layout?.nodes.map((node) => [node.nodeId, node]) ?? [])
    return definition.nodes.map((node, index) => {
      const layout = layoutByNodeId.get(node.id)
      return {
        label: node.name,
        nodeId: node.id,
        type: node.type,
        x: layout?.x ?? 120 + index * 190,
        y: layout?.y ?? 120,
      }
    })
  }, [definition])

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.nodeId, node])), [nodes])
  const pendingConnectionTargetId = useMemo(() => {
    if (!pendingConnection) return null

    const target = nodes.find((node) => (
      node.nodeId !== pendingConnection.sourceNodeId &&
      pendingConnection.x >= node.x &&
      pendingConnection.x <= node.x + NODE_WIDTH &&
      pendingConnection.y >= node.y &&
      pendingConnection.y <= node.y + NODE_HEIGHT
    ))

    return target?.nodeId ?? null
  }, [nodes, pendingConnection])

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: clientX, y: clientY }

    if (typeof svg.createSVGPoint !== 'function') {
      return {
        x: zoomTransformRef.current.invertX(clientX),
        y: zoomTransformRef.current.invertY(clientY),
      }
    }

    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const matrix = svg.getScreenCTM()
    const transformed = matrix ? point.matrixTransform(matrix.inverse()) : point

    return {
      x: zoomTransformRef.current.invertX(transformed.x),
      y: zoomTransformRef.current.invertY(transformed.y),
    }
  }, [])

  const findNodeAtPoint = useCallback((x: number, y: number, excludedNodeId: string) => {
    return nodes.find((node) => (
      node.nodeId !== excludedNodeId &&
      x >= node.x &&
      x <= node.x + NODE_WIDTH &&
      y >= node.y &&
      y <= node.y + NODE_HEIGHT
    )) ?? null
  }, [nodes])

  const clearConnection = useCallback(() => {
    setPendingConnection(null)
  }, [])

  const startConnection = useCallback((node: CanvasNode, event: PointerEvent<SVGGElement>) => {
    stopCanvasAction(event)
    setAddMenuNodeId(null)
    setPendingConnection({
      sourceNodeId: node.nodeId,
      x: node.x + NODE_WIDTH,
      y: node.y + NODE_HEIGHT / 2,
    })
    if (typeof svgRef.current?.setPointerCapture === 'function') {
      svgRef.current.setPointerCapture(event.pointerId)
    }
  }, [])

  const handlePointerMove = useCallback((event: PointerEvent<SVGSVGElement>) => {
    if (!pendingConnection) return

    const point = getCanvasPoint(event.clientX, event.clientY)
    setPendingConnection((current) => current ? { ...current, x: point.x, y: point.y } : null)
  }, [getCanvasPoint, pendingConnection])

  const handlePointerUp = useCallback((event: PointerEvent<SVGSVGElement>) => {
    if (!pendingConnection) return

    const point = getCanvasPoint(event.clientX, event.clientY)
    const target = findNodeAtPoint(point.x, point.y, pendingConnection.sourceNodeId)
    if (target) onConnectNodes(pendingConnection.sourceNodeId, target.nodeId)
    setPendingConnection(null)
  }, [findNodeAtPoint, getCanvasPoint, onConnectNodes, pendingConnection])

  const handleActionKeyDown = useCallback((event: KeyboardEvent<SVGGElement>, action: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    event.stopPropagation()
    action()
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    const layer = zoomLayerRef.current
    if (!svg || !layer) return

    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 2.5])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        zoomTransformRef.current = event.transform
        select(layer).attr('transform', event.transform.toString())
      })

    select(svg).call(zoomBehavior)
    return () => {
      select(svg).on('.zoom', null)
    }
  }, [])

  useEffect(() => {
    const currentNodeRefs = nodeRefs.current

    nodes.forEach((node) => {
      const element = currentNodeRefs.get(node.nodeId)
      if (!element) return

      const dragBehavior = d3drag<SVGGElement, CanvasNode>()
        .on('drag', (event) => {
          onMoveNode(node.nodeId, event.x, event.y)
        })

      select(element).datum(node).call(dragBehavior)
    })

    return () => {
      currentNodeRefs.forEach((element) => select(element).on('.drag', null))
    }
  }, [nodes, onMoveNode])

  return (
    <div className="min-h-[420px] overflow-hidden rounded-lg border border-border/50 bg-background/40">
      <svg
        ref={svgRef}
        className="h-[420px] w-full touch-none"
        role="img"
        aria-label="Flow diagram editor"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={clearConnection}
      >
        <defs>
          <pattern id="flow-dot-grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" className="fill-muted-foreground/15" />
          </pattern>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/70" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#flow-dot-grid)" />
        <g ref={zoomLayerRef}>
          {definition.edges.map((edge) => {
            const source = nodeById.get(edge.sourceNodeId)
            const target = nodeById.get(edge.targetNodeId)
            if (!source || !target) return null

            const startX = source.x + NODE_WIDTH
            const startY = source.y + NODE_HEIGHT / 2
            const endX = target.x
            const endY = target.y + NODE_HEIGHT / 2
            const midX = (startX + endX) / 2
            const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`

            return (
              <g key={edge.id} className="group">
                <path d={path} fill="none" stroke="currentColor" strokeWidth="2" markerEnd="url(#flow-arrow)" className="text-muted-foreground/70" />
                {edge.label ? (
                  <text x={midX} y={(startY + endY) / 2 - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {edge.label}
                  </text>
                ) : null}
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove connection ${source.label} to ${target.label}`}
                  transform={`translate(${midX}, ${(startY + endY) / 2})`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemoveConnection(edge.id)
                  }}
                  onKeyDown={(event) => handleActionKeyDown(event, () => onRemoveConnection(edge.id))}
                  onMouseDown={stopCanvasAction}
                  onTouchStart={stopCanvasAction}
                  className="cursor-pointer opacity-0 outline-none transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <circle r="9" className="fill-card stroke-border" strokeWidth="1.2" />
                  <text textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[11px] font-semibold">×</text>
                </g>
              </g>
            )
          })}

          {pendingConnection ? (() => {
            const source = nodeById.get(pendingConnection.sourceNodeId)
            if (!source) return null

            const startX = source.x + NODE_WIDTH
            const startY = source.y + NODE_HEIGHT / 2
            const midX = (startX + pendingConnection.x) / 2
            const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${pendingConnection.y}, ${pendingConnection.x} ${pendingConnection.y}`

            return <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" className="text-primary" />
          })() : null}

          {nodes.map((node) => {
            const selected = selectedNodeId === node.nodeId
            const showActions = hoveredNodeId === node.nodeId || addMenuNodeId === node.nodeId || pendingConnection?.sourceNodeId === node.nodeId
            const connectionTarget = pendingConnectionTargetId === node.nodeId
            const hiddenAction = showActions ? 'opacity-100' : 'opacity-0 pointer-events-none'
            return (
              <g
                key={node.nodeId}
                ref={(element) => {
                  if (element) nodeRefs.current.set(node.nodeId, element)
                  else nodeRefs.current.delete(node.nodeId)
                }}
                transform={`translate(${node.x}, ${node.y})`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${node.label}`}
                data-node="true"
                onClick={() => onSelectNode(node.nodeId)}
                onPointerEnter={() => setHoveredNodeId(node.nodeId)}
                onPointerLeave={() => setHoveredNodeId((current) => current === node.nodeId ? null : current)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.nodeId)
                }}
                className="cursor-grab outline-none active:cursor-grabbing"
              >
                <title>{node.label}</title>
                <rect
                  x={-6}
                  y={-36}
                  width={NODE_WIDTH + 44}
                  height={NODE_HEIGHT + 44}
                  fill="transparent"
                  pointerEvents="all"
                />
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx="12"
                  className={cn(
                    'fill-card stroke-border transition-colors',
                    selected && 'stroke-primary',
                    connectionTarget && 'stroke-primary fill-primary/10',
                  )}
                  strokeWidth={selected || connectionTarget ? 2 : 1}
                />
                <text x="14" y="23" className="fill-foreground text-[12px] font-semibold">
                  {node.label.length > 20 ? `${node.label.slice(0, 19)}...` : node.label}
                </text>
                <text x="14" y="41" className="fill-muted-foreground text-[10px] uppercase tracking-wide">
                  {node.type}
                </text>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit ${node.label}`}
                  transform={`translate(${NODE_WIDTH - 54}, -28)`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onEditNode(node.nodeId)
                  }}
                  onKeyDown={(event) => handleActionKeyDown(event, () => onEditNode(node.nodeId))}
                  onMouseDown={stopCanvasAction}
                  onTouchStart={stopCanvasAction}
                  className={cn('group/edit cursor-pointer outline-none transition-opacity focus:opacity-100', hiddenAction)}
                >
                  <rect width="54" height="22" rx="11" className="fill-card stroke-border transition-colors group-hover/edit:fill-muted group-hover/edit:stroke-primary/50" strokeWidth="1" />
                  <text x="27" y="14" textAnchor="middle" className="fill-foreground text-[10px] font-medium">Edit</text>
                </g>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Connect from ${node.label}`}
                  transform={`translate(${NODE_WIDTH + 4}, ${NODE_HEIGHT / 2})`}
                  onPointerDown={(event) => startConnection(node, event)}
                  onMouseDown={stopCanvasAction}
                  onTouchStart={stopCanvasAction}
                  onKeyDown={(event) => handleActionKeyDown(event, () => setAddMenuNodeId(node.nodeId))}
                  className={cn('group/dot cursor-crosshair outline-none transition-opacity focus:opacity-100', hiddenAction)}
                >
                  <circle r="5.5" className="fill-card stroke-primary/70 transition-colors group-hover/dot:stroke-primary" strokeWidth="1.5" />
                  <circle r="2" className="fill-primary" />
                </g>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Add node after ${node.label}`}
                  transform={`translate(${NODE_WIDTH + 24}, ${NODE_HEIGHT / 2})`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setAddMenuNodeId((current) => current === node.nodeId ? null : node.nodeId)
                  }}
                  onKeyDown={(event) => handleActionKeyDown(event, () => setAddMenuNodeId((current) => current === node.nodeId ? null : node.nodeId))}
                  onMouseDown={stopCanvasAction}
                  onTouchStart={stopCanvasAction}
                  className={cn('group/add cursor-pointer outline-none transition-opacity focus:opacity-100', hiddenAction)}
                >
                  <circle r="9" className="fill-card stroke-border transition-colors group-hover/add:fill-muted group-hover/add:stroke-primary/60" strokeWidth="1" />
                  <path
                    d="M -3.5 0 L 3.5 0 M 0 -3.5 L 0 3.5"
                    className="stroke-muted-foreground transition-colors group-hover/add:stroke-foreground"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    fill="none"
                  />
                </g>
                {addMenuNodeId === node.nodeId ? (
                  <g transform={`translate(${NODE_WIDTH + 40}, -8)`}>
                    <rect width="104" height="138" rx="10" className="fill-card stroke-border drop-shadow-sm" strokeWidth="1" />
                    {ADD_NODE_TYPES.map((item, index) => (
                      <g
                        key={item.type}
                        role="button"
                        tabIndex={0}
                        aria-label={`Add ${item.label.toLowerCase()} step after ${node.label}`}
                        transform={`translate(8, ${8 + index * 26})`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onAddNodeAfter(node.nodeId, item.type)
                          setAddMenuNodeId(null)
                        }}
                        onKeyDown={(event) => handleActionKeyDown(event, () => {
                          onAddNodeAfter(node.nodeId, item.type)
                          setAddMenuNodeId(null)
                        })}
                        onMouseDown={stopCanvasAction}
                        onTouchStart={stopCanvasAction}
                        className="cursor-pointer outline-none"
                      >
                        <rect width="88" height="22" rx="8" className="fill-transparent transition-colors hover:fill-muted" />
                        <text x="10" y="14" className="fill-foreground text-[11px] font-medium">{item.label}</text>
                      </g>
                    ))}
                  </g>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
