'use client'

import { useEffect, useMemo, useRef } from 'react'
import { drag as d3drag } from 'd3-drag'
import { select } from 'd3-selection'
import { zoom as d3zoom, type D3ZoomEvent } from 'd3-zoom'

import type { FlowDefinition, FlowLayoutNode } from '@/lib/flows/types'
import { cn } from '@/lib/utils'

type FlowCanvasProps = {
  definition: FlowDefinition
  selectedNodeId: string | null
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onSelectNode: (nodeId: string) => void
}

type CanvasNode = FlowLayoutNode & {
  label: string
  type: string
}

const NODE_WIDTH = 156
const NODE_HEIGHT = 56

export function FlowCanvas({ definition, selectedNodeId, onMoveNode, onSelectNode }: FlowCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const zoomLayerRef = useRef<SVGGElement | null>(null)
  const nodeRefs = useRef<Map<string, SVGGElement>>(new Map())

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

  useEffect(() => {
    const svg = svgRef.current
    const layer = zoomLayerRef.current
    if (!svg || !layer) return

    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 2.5])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
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
    <div className="min-h-[420px] overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <svg ref={svgRef} className="h-[420px] w-full touch-none" role="img" aria-label="Flow diagram editor">
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
        </defs>
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
              <g key={edge.id}>
                <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#flow-arrow)" className="text-muted-foreground/60" />
                {edge.label ? (
                  <text x={midX} y={(startY + endY) / 2 - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {nodes.map((node) => {
            const selected = selectedNodeId === node.nodeId
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
                data-node="true"
                onClick={() => onSelectNode(node.nodeId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.nodeId)
                }}
                className="cursor-grab outline-none active:cursor-grabbing"
              >
                <title>{node.label}</title>
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx="14"
                  className={cn(
                    'fill-background stroke-border transition-colors',
                    selected && 'stroke-primary',
                  )}
                  strokeWidth={selected ? 2.5 : 1.2}
                />
                <text x="14" y="23" className="fill-foreground text-[12px] font-semibold">
                  {node.label.length > 20 ? `${node.label.slice(0, 19)}...` : node.label}
                </text>
                <text x="14" y="41" className="fill-muted-foreground text-[10px] uppercase tracking-wide">
                  {node.type}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
