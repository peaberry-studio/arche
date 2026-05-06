'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, SpinnerGap } from '@phosphor-icons/react'
import { drag as d3drag } from 'd3-drag'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom as d3zoom } from 'd3-zoom'

import {
  buildKnowledgeGraph,
  type KnowledgeGraphAgentSource,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
} from '@/lib/kb-graph'
import type { WorkspaceFileNode } from '@/lib/opencode/types'
import { cn } from '@/lib/utils'

type OpenKnowledgeFile = {
  content: string
  path: string
}

type KnowledgeGraphPanelProps = {
  activeFilePath: string | null
  agentSources: KnowledgeGraphAgentSource[]
  fileNodes: WorkspaceFileNode[]
  onOpenFile: (path: string) => void
  openFiles: OpenKnowledgeFile[]
  readFile: (path: string) => Promise<{ content: string; type: 'patch' | 'raw'; hash?: string } | null>
  reloadKey: number
}

type SimNode = SimulationNodeDatum & KnowledgeGraphNode
type SimEdge = SimulationLinkDatum<SimNode> & {
  id: string
  kind: KnowledgeGraphEdge['kind']
}

const MIN_RADIUS_FILE = 4
const MAX_RADIUS_FILE = 15
const MIN_RADIUS_AGENT = 5
const MAX_RADIUS_AGENT = 16
const ACTIVE_BOOST = 2
const LABEL_BASE_OPACITY = 0
const LABEL_VISIBLE_ZOOM = 0.72
const LABEL_FULL_ZOOM = 1.75
const LABEL_SCREEN_FONT_SIZE = 8
const LABEL_SCREEN_GAP = 7
const CHARGE_DISTANCE_MAX = 180
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

type LayoutTarget = {
  strength: number
  x: number
  y: number
}

function flattenMarkdownFilePaths(nodes: WorkspaceFileNode[]): string[] {
  const paths: string[] = []

  function visit(entries: WorkspaceFileNode[]) {
    for (const node of entries) {
      if (node.type === 'file' && node.path.toLowerCase().endsWith('.md')) {
        paths.push(node.path)
      }

      if (node.children) {
        visit(node.children)
      }
    }
  }

  visit(nodes)
  return Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right))
}

function shortenLabel(label: string): string {
  return label.length > 30 ? `${label.slice(0, 27)}...` : label
}

function buildDegreeById(edges: KnowledgeGraphEdge[]): Map<string, number> {
  const degreeById = new Map<string, number>()
  for (const edge of edges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1)
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1)
  }
  return degreeById
}

function getMaxNodeRadius(node: KnowledgeGraphNode): number {
  return node.kind === 'file' ? MAX_RADIUS_FILE : MAX_RADIUS_AGENT
}

function getNodeRadius(
  node: KnowledgeGraphNode,
  degreeById: Map<string, number>
): number {
  const degree = degreeById.get(node.id) ?? 0
  const minRadius = node.kind === 'file' ? MIN_RADIUS_FILE : MIN_RADIUS_AGENT
  const radius = minRadius + Math.sqrt(degree) * 1.6
  return Math.min(getMaxNodeRadius(node), Math.max(minRadius, radius))
}

function getLinkEndpointId(endpoint: SimEdge['source']): string {
  return typeof endpoint === 'object' ? endpoint.id : String(endpoint)
}

function getLinkEndpointDegree(
  endpoint: SimEdge['source'],
  degreeById: Map<string, number>
): number {
  return degreeById.get(getLinkEndpointId(endpoint)) ?? 0
}

function buildLayoutTargets(
  nodes: SimNode[],
  edges: KnowledgeGraphEdge[],
  degreeById: Map<string, number>,
  width: number,
  height: number
): Map<string, LayoutTarget> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const neighborsById = new Map<string, string[]>()
  for (const node of nodes) {
    neighborsById.set(node.id, [])
  }

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue
    neighborsById.get(edge.source)?.push(edge.target)
    neighborsById.get(edge.target)?.push(edge.source)
  }

  const visited = new Set<string>()
  const components: SimNode[][] = []

  for (const node of nodes) {
    if (visited.has(node.id)) continue

    const component: SimNode[] = []
    const stack = [node.id]
    visited.add(node.id)

    while (stack.length > 0) {
      const id = stack.pop()
      if (!id) continue

      const current = nodeById.get(id)
      if (!current) continue

      component.push(current)

      for (const neighborId of neighborsById.get(id) ?? []) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        stack.push(neighborId)
      }
    }

    components.push(component)
  }

  components.sort(
    (left, right) =>
      right.length - left.length ||
      (left[0]?.label ?? '').localeCompare(right[0]?.label ?? '')
  )

  const targets = new Map<string, LayoutTarget>()
  const connectedComponents = components.filter((component) =>
    component.some((node) => (degreeById.get(node.id) ?? 0) > 0)
  )

  if (connectedComponents.length > 0) {
    const componentCount = connectedComponents.length
    const aspectRatio = width / Math.max(height, 1)
    const columns = Math.min(
      componentCount,
      Math.max(1, Math.ceil(Math.sqrt(componentCount * aspectRatio)))
    )
    const rows = Math.max(1, Math.ceil(componentCount / columns))
    const paddingX = Math.min(88, Math.max(32, width * 0.1))
    const paddingY = Math.min(76, Math.max(28, height * 0.12))
    const usableWidth = Math.max(width - paddingX * 2, width * 0.55)
    const usableHeight = Math.max(height - paddingY * 2, height * 0.55)
    const originX = (width - usableWidth) / 2
    const originY = (height - usableHeight) / 2
    const cellWidth = usableWidth / columns
    const cellHeight = usableHeight / rows

    const slots = Array.from({ length: componentCount }, (_, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = originX + column * cellWidth + cellWidth / 2
      const y = originY + row * cellHeight + cellHeight / 2
      return {
        index,
        x,
        y,
        distanceFromCenter: (x - width / 2) ** 2 + (y - height / 2) ** 2,
      }
    }).sort(
      (left, right) =>
        left.distanceFromCenter - right.distanceFromCenter || left.index - right.index
    )

    connectedComponents.forEach((component, componentIndex) => {
      const slot = slots[componentIndex]
      if (!slot) return

      const componentNodes = [...component].sort(
        (left, right) =>
          (degreeById.get(right.id) ?? 0) - (degreeById.get(left.id) ?? 0) ||
          left.kind.localeCompare(right.kind) ||
          left.label.localeCompare(right.label)
      )
      const localColumns = Math.max(1, Math.ceil(Math.sqrt(componentNodes.length)))
      const localRows = Math.max(1, Math.ceil(componentNodes.length / localColumns))
      const localSpacingX = Math.min(84, cellWidth / Math.max(localColumns, 1))
      const localSpacingY = Math.min(68, cellHeight / Math.max(localRows, 1))
      const localSlots = Array.from({ length: componentNodes.length }, (_, index) => {
        const column = index % localColumns
        const row = Math.floor(index / localColumns)
        const x = slot.x + (column - (localColumns - 1) / 2) * localSpacingX
        const y = slot.y + (row - (localRows - 1) / 2) * localSpacingY
        return {
          index,
          x,
          y,
          distanceFromCenter: (x - slot.x) ** 2 + (y - slot.y) ** 2,
        }
      }).sort(
        (left, right) =>
          left.distanceFromCenter - right.distanceFromCenter || left.index - right.index
      )

      componentNodes.forEach((node, index) => {
        const localSlot = localSlots[index]
        if (!localSlot) return

        const degree = degreeById.get(node.id) ?? 0
        targets.set(node.id, {
          strength: Math.min(0.18, 0.07 + Math.sqrt(degree) * 0.025),
          x: localSlot.x,
          y: localSlot.y,
        })
      })
    })
  }

  const isolatedNodes = components
    .filter((component) =>
      component.every((node) => (degreeById.get(node.id) ?? 0) === 0)
    )
    .flat()
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label)
    )

  const isolatedCount = isolatedNodes.length
  const isolatedRadiusX = Math.max(24, Math.min(width / 2 - 24, width * 0.46))
  const isolatedRadiusY = Math.max(24, Math.min(height / 2 - 24, height * 0.46))
  isolatedNodes.forEach((node, index) => {
    const radiusRatio = Math.sqrt((index + 0.5) / isolatedCount)
    const angle = -Math.PI / 2 + index * GOLDEN_ANGLE
    targets.set(node.id, {
      strength: 0.14,
      x: width / 2 + Math.cos(angle) * isolatedRadiusX * radiusRatio,
      y: height / 2 + Math.sin(angle) * isolatedRadiusY * radiusRatio,
    })
  })

  return targets
}

export function KnowledgeGraphPanel({
  activeFilePath,
  agentSources,
  fileNodes,
  onOpenFile,
  openFiles,
  readFile,
  reloadKey,
}: KnowledgeGraphPanelProps) {
  const markdownPaths = useMemo(() => flattenMarkdownFilePaths(fileNodes), [fileNodes])
  const hasMarkdownFiles = markdownPaths.length > 0
  const [contentByPath, setContentByPath] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadMarkdownFiles() {
      setIsLoading(markdownPaths.length > 0)

      const entries = await Promise.all(
        markdownPaths.map(async (path) => {
          try {
            const result = await readFile(path)
            return [path, result?.content ?? ''] as const
          } catch {
            return [path, ''] as const
          }
        })
      )

      if (cancelled) return

      setContentByPath(Object.fromEntries(entries))
      setIsLoading(false)
    }

    void loadMarkdownFiles()

    return () => {
      cancelled = true
    }
  }, [markdownPaths, readFile, reloadKey])

  const openFileContentByPath = useMemo(
    () => new Map(openFiles.map((file) => [file.path, file.content])),
    [openFiles]
  )

  const graph = useMemo(
    () => buildKnowledgeGraph({
      agents: agentSources,
      files: markdownPaths.map((path) => ({
        path,
        content: openFileContentByPath.get(path) ?? contentByPath[path] ?? '',
      })),
    }),
    [agentSources, contentByPath, markdownPaths, openFileContentByPath]
  )
  const degreeById = useMemo(() => buildDegreeById(graph.edges), [graph.edges])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const zoomLayerRef = useRef<SVGGElement | null>(null)
  const nodeElsRef = useRef<Map<string, SVGGElement>>(new Map())
  const edgeElsRef = useRef<Map<string, SVGLineElement>>(new Map())
  const nodeCircleElsRef = useRef<Map<string, SVGCircleElement>>(new Map())
  const nodeHaloElsRef = useRef<Map<string, SVGCircleElement>>(new Map())
  const labelElsRef = useRef<Map<string, SVGTextElement>>(new Map())
  const simulationRef = useRef<Simulation<SimNode, SimEdge> | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simEdgesRef = useRef<SimEdge[]>([])
  const zoomScaleRef = useRef(1)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)

  const updateZoomScaledElements = useCallback((scale: number) => {
    const labelOpacity = Math.max(
      LABEL_BASE_OPACITY,
      Math.min(1, (scale - LABEL_VISIBLE_ZOOM) / (LABEL_FULL_ZOOM - LABEL_VISIBLE_ZOOM))
    )
    const labelZoomScale = Math.max(1, scale) ** 0.72
    const nodeZoomScale = Math.max(1, scale) ** 0.68
    const edgeZoomScale = Math.max(1, scale) ** 0.72

    for (const labelEl of labelElsRef.current.values()) {
      labelEl.setAttribute(
        'y',
        String(Number(labelEl.dataset.radius ?? 0) + LABEL_SCREEN_GAP / labelZoomScale)
      )
      labelEl.style.fontSize = `${LABEL_SCREEN_FONT_SIZE / labelZoomScale}px`
      labelEl.style.opacity = labelEl.dataset.emphasized === 'true' ? '1' : String(labelOpacity)
    }

    for (const circleEl of nodeCircleElsRef.current.values()) {
      circleEl.setAttribute('r', String(Number(circleEl.dataset.radius ?? 0) / nodeZoomScale))
    }

    for (const circleEl of nodeHaloElsRef.current.values()) {
      circleEl.setAttribute('r', String(Number(circleEl.dataset.radius ?? 0) / nodeZoomScale))
    }

    for (const edgeEl of edgeElsRef.current.values()) {
      edgeEl.setAttribute(
        'stroke-width',
        String(Number(edgeEl.dataset.strokeWidth ?? 1) / edgeZoomScale)
      )
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    setSize({ width: el.clientWidth, height: el.clientHeight })
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!size.width || !size.height) return

    const previous = new Map(simNodesRef.current.map((node) => [node.id, node]))
    const nextNodes: SimNode[] = graph.nodes.map((node) => {
      const existing = previous.get(node.id)
      if (existing) {
        return Object.assign(existing, node)
      }
      return { ...node }
    })
    const nextEdges: SimEdge[] = graph.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      source: edge.source,
      target: edge.target,
    }))
    const layoutTargets = buildLayoutTargets(
      nextNodes,
      graph.edges,
      degreeById,
      size.width,
      size.height
    )

    for (const node of nextNodes) {
      const target = layoutTargets.get(node.id)
      if (!target || (typeof node.x === 'number' && typeof node.y === 'number')) continue
      node.x = target.x
      node.y = target.y
    }

    simNodesRef.current = nextNodes
    simEdgesRef.current = nextEdges

    const positionStrength = (node: SimNode) =>
      layoutTargets.get(node.id)?.strength ?? 0.08

    simulationRef.current?.stop()
    const simulation = forceSimulation<SimNode, SimEdge>(nextNodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(nextEdges)
          .id((d) => d.id)
          .distance((edge) => {
            const sourceDegree = getLinkEndpointDegree(edge.source, degreeById)
            const targetDegree = getLinkEndpointDegree(edge.target, degreeById)
            const avgDegree = (sourceDegree + targetDegree) / 2
            const baseDistance = avgDegree > 5 ? 58 : avgDegree > 2 ? 78 : 96
            return edge.kind === 'agent-reference' ? baseDistance + 14 : baseDistance
          })
          .strength((edge) => {
            const sourceDegree = getLinkEndpointDegree(edge.source, degreeById)
            const targetDegree = getLinkEndpointDegree(edge.target, degreeById)
            const avgDegree = (sourceDegree + targetDegree) / 2
            return avgDegree > 5 ? 0.5 : avgDegree > 2 ? 0.36 : 0.24
          })
      )
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength((node) =>
            (degreeById.get(node.id) ?? 0) === 0
              ? -35
              : -130 - Math.min(degreeById.get(node.id) ?? 0, 12) * 12
          )
          .distanceMax(CHARGE_DISTANCE_MAX)
      )
      .force(
        'center',
        forceCenter<SimNode>(size.width / 2, size.height / 2).strength(0.05)
      )
      .force(
        'x',
        forceX<SimNode>((node) =>
          layoutTargets.get(node.id)?.x ?? size.width / 2
        ).strength(positionStrength)
      )
      .force(
        'y',
        forceY<SimNode>((node) =>
          layoutTargets.get(node.id)?.y ?? size.height / 2
        ).strength(positionStrength)
      )
      .force(
        'collide',
        forceCollide<SimNode>((node) => getNodeRadius(node, degreeById) + 6).strength(0.8)
      )
      .alpha(1)
      .alphaDecay(0.06)
      .on('tick', () => {
        for (const node of nextNodes) {
          const el = nodeElsRef.current.get(node.id)
          if (el) {
            el.setAttribute(
              'transform',
              `translate(${node.x ?? 0}, ${node.y ?? 0})`
            )
          }
        }
        for (const edge of nextEdges) {
          const el = edgeElsRef.current.get(edge.id)
          if (!el) continue
          const source = edge.source as SimNode
          const target = edge.target as SimNode
          if (typeof source !== 'object' || typeof target !== 'object') continue
          el.setAttribute('x1', String(source.x ?? 0))
          el.setAttribute('y1', String(source.y ?? 0))
          el.setAttribute('x2', String(target.x ?? 0))
          el.setAttribute('y2', String(target.y ?? 0))
        }
      })

    simulationRef.current = simulation

    return () => {
      simulation.stop()
    }
  }, [degreeById, graph, size.width, size.height])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return

    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .filter((event: Event) => {
        const target = event.target as Element | null
        if (target?.closest('[data-node="true"]')) return false
        if (event.type === 'mousedown') {
          return !(event as MouseEvent).button
        }
        return !(event as MouseEvent).ctrlKey
      })
      .on('zoom', (event) => {
        zoomScaleRef.current = event.transform.k
        zoomLayerRef.current?.setAttribute('transform', event.transform.toString())
        updateZoomScaledElements(event.transform.k)
      })

    select(svgEl).call(zoomBehavior).on('dblclick.zoom', null)

    return () => {
      select(svgEl).on('.zoom', null)
    }
  }, [hasMarkdownFiles, updateZoomScaledElements])

  useEffect(() => {
    updateZoomScaledElements(zoomScaleRef.current)
  }, [activeFilePath, graph.edges, graph.nodes, hoverNodeId, updateZoomScaledElements])

  useEffect(() => {
    const simulation = simulationRef.current
    if (!simulation) return

    const dragBehavior = d3drag<SVGGElement, SimNode>()
      .clickDistance(4)
      .on('start', (event, datum) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        datum.fx = datum.x
        datum.fy = datum.y
      })
      .on('drag', (event, datum) => {
        datum.fx = event.x
        datum.fy = event.y
      })
      .on('end', (event, datum) => {
        if (!event.active) simulation.alphaTarget(0)
        datum.fx = null
        datum.fy = null
      })

    const elements = nodeElsRef.current
    const attached: SVGGElement[] = []
    for (const node of simNodesRef.current) {
      const el = elements.get(node.id)
      if (el) {
        select<SVGGElement, SimNode>(el).datum(node).call(dragBehavior)
        attached.push(el)
      }
    }

    return () => {
      for (const el of attached) {
        select(el).on('.drag', null)
      }
    }
  }, [graph, size.width, size.height])

  const fileCount = graph.nodes.filter((node) => node.kind === 'file').length
  const agentCount = graph.nodes.filter((node) => node.kind === 'agent').length

  const connectedIds = useMemo(() => {
    if (!hoverNodeId) return new Set<string>()
    const set = new Set<string>([hoverNodeId])
    for (const edge of graph.edges) {
      if (edge.source === hoverNodeId) set.add(edge.target)
      if (edge.target === hoverNodeId) set.add(edge.source)
    }
    return set
  }, [graph.edges, hoverNodeId])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-card-foreground">
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        {!hasMarkdownFiles ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <FileText size={34} className="text-muted-foreground/30" />
            <p className="max-w-[260px] text-sm text-muted-foreground">
              Add markdown files to your Knowledge Base to build the graph.
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            role="img"
            aria-label="Knowledge graph"
            className="h-full w-full cursor-grab touch-none outline-none focus:outline-none active:cursor-grabbing"
            width={size.width || undefined}
            height={size.height || undefined}
          >
            <g ref={zoomLayerRef}>
              <g className="links">
                {graph.edges.map((edge) => {
                  const isHovered =
                    hoverNodeId !== null &&
                    (edge.source === hoverNodeId || edge.target === hoverNodeId)
                  const dim = hoverNodeId !== null && !isHovered

                  return (
                    <line
                      key={edge.id}
                      ref={(el) => {
                        if (el) edgeElsRef.current.set(edge.id, el)
                        else edgeElsRef.current.delete(edge.id)
                      }}
                      className={cn(
                        isHovered
                          ? edge.kind === 'agent-reference'
                            ? 'stroke-amber-600/90'
                            : 'stroke-foreground/70'
                          : edge.kind === 'agent-reference'
                            ? 'stroke-amber-500/25'
                            : 'stroke-foreground/12',
                        dim && 'opacity-10'
                      )}
                      strokeWidth={isHovered ? 1.5 : 1}
                      data-stroke-width={isHovered ? 1.5 : 1}
                      strokeLinecap="round"
                      style={{ transition: 'opacity 160ms ease, stroke 160ms ease' }}
                    />
                  )
                })}
              </g>

              <g className="nodes">
                {graph.nodes.map((node) => {
                  const isFile = node.kind === 'file'
                  const isActive = isFile && node.path === activeFilePath
                  const isHovered = hoverNodeId === node.id
                  const isConnected = connectedIds.has(node.id)
                  const dim = hoverNodeId !== null && !isConnected
                  const isHoverNeighbor = hoverNodeId !== null && isConnected && !isHovered
                  const baseRadius = getNodeRadius(node, degreeById)
                  const radius = Math.min(
                    getMaxNodeRadius(node),
                    baseRadius + (isActive ? ACTIVE_BOOST : 0) + (isHovered ? 1.5 : 0)
                  )
                  const nodeFillClass = isHovered
                    ? 'fill-orange-500'
                    : isHoverNeighbor
                      ? 'fill-foreground/75'
                      : isFile
                        ? isActive
                          ? 'fill-primary'
                          : 'fill-primary/85'
                        : 'fill-amber-500'

                  return (
                    <g
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeElsRef.current.set(node.id, el)
                        else nodeElsRef.current.delete(node.id)
                      }}
                      data-node="true"
                      role={isFile ? 'button' : 'img'}
                      aria-label={isFile ? node.path : node.label}
                      tabIndex={isFile ? 0 : undefined}
                      onMouseEnter={() => setHoverNodeId(node.id)}
                      onMouseLeave={() =>
                        setHoverNodeId((current) => (current === node.id ? null : current))
                      }
                      onClick={(event) => {
                        if (!node.path) return
                        event.stopPropagation()
                        onOpenFile(node.path)
                      }}
                      onKeyDown={(event) => {
                        if (!node.path || (event.key !== 'Enter' && event.key !== ' ')) return
                        event.preventDefault()
                        onOpenFile(node.path)
                      }}
                      className={cn(
                        'outline-none focus:outline-none focus-visible:outline-none',
                        isFile ? 'cursor-pointer' : 'cursor-grab',
                        'transition-opacity duration-200 ease-out',
                        dim && 'opacity-10'
                      )}
                    >
                      {isActive || isHovered ? (
                        <circle
                          ref={(el) => {
                            if (el) nodeHaloElsRef.current.set(node.id, el)
                            else nodeHaloElsRef.current.delete(node.id)
                          }}
                          r={radius + 6}
                          data-radius={radius + 6}
                          className={cn(
                            'transition-colors duration-200 ease-out',
                            isHovered
                              ? 'fill-orange-500/20'
                              : isFile
                                ? 'fill-primary/20'
                                : 'fill-amber-500/20'
                          )}
                        />
                      ) : null}
                      <circle
                        ref={(el) => {
                          if (el) nodeCircleElsRef.current.set(node.id, el)
                          else nodeCircleElsRef.current.delete(node.id)
                        }}
                        r={radius}
                        data-radius={radius}
                        className={cn('transition-colors duration-200 ease-out', nodeFillClass)}
                      />
                      <text
                        ref={(el) => {
                          if (el) labelElsRef.current.set(node.id, el)
                          else labelElsRef.current.delete(node.id)
                        }}
                        y={radius + LABEL_SCREEN_GAP}
                        textAnchor="middle"
                        data-emphasized={isHovered || isActive ? 'true' : 'false'}
                        data-radius={radius}
                        style={{
                          fontSize: `${LABEL_SCREEN_FONT_SIZE}px`,
                          opacity: isHovered || isActive ? 1 : LABEL_BASE_OPACITY,
                        }}
                        className="pointer-events-none fill-muted-foreground font-medium"
                      >
                        {shortenLabel(node.label)}
                      </text>
                      {node.path ? (
                        <title>{node.path}</title>
                      ) : (
                        <title>{node.label}</title>
                      )}
                    </g>
                  )
                })}
              </g>
            </g>
          </svg>
        )}

        {isLoading ? (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-border/40 bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            <SpinnerGap size={11} className="animate-spin" />
            Reading markdown files
          </div>
        ) : null}

        {hasMarkdownFiles ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2">
            <div className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-border/40 bg-background/85 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {fileCount} {fileCount === 1 ? 'file' : 'files'}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
              </span>
              <span className="opacity-40">·</span>
              <span>
                {graph.edges.length} {graph.edges.length === 1 ? 'link' : 'links'}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
