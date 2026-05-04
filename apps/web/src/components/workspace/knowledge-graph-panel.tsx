'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'

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

const NODE_RADIUS_FILE = 5
const NODE_RADIUS_AGENT = 6
const ACTIVE_BOOST = 2.5
const LABEL_BASE_OPACITY = 0.25
const LABEL_FULL_ZOOM = 1.4

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

  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const zoomLayerRef = useRef<SVGGElement | null>(null)
  const nodeElsRef = useRef<Map<string, SVGGElement>>(new Map())
  const edgeElsRef = useRef<Map<string, SVGLineElement>>(new Map())
  const simulationRef = useRef<Simulation<SimNode, SimEdge> | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simEdgesRef = useRef<SimEdge[]>([])

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)

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
      return {
        ...node,
        x: size.width / 2 + (Math.random() - 0.5) * 80,
        y: size.height / 2 + (Math.random() - 0.5) * 80,
      }
    })
    const nextEdges: SimEdge[] = graph.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      source: edge.source,
      target: edge.target,
    }))

    simNodesRef.current = nextNodes
    simEdgesRef.current = nextEdges

    const degreeById = new Map<string, number>()
    for (const edge of graph.edges) {
      degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1)
      degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1)
    }
    const positionStrength = (node: SimNode) =>
      (degreeById.get(node.id) ?? 0) === 0 ? 0.18 : 0.04

    simulationRef.current?.stop()
    const simulation = forceSimulation<SimNode, SimEdge>(nextNodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(nextEdges)
          .id((d) => d.id)
          .distance(130)
          .strength(0.4)
      )
      .force(
        'charge',
        forceManyBody<SimNode>().strength((node) =>
          (degreeById.get(node.id) ?? 0) === 0 ? -180 : -380
        )
      )
      .force(
        'center',
        forceCenter<SimNode>(size.width / 2, size.height / 2).strength(0.05)
      )
      .force('x', forceX<SimNode>(size.width / 2).strength(positionStrength))
      .force('y', forceY<SimNode>(size.height / 2).strength(positionStrength))
      .force('collide', forceCollide<SimNode>(32))
      .alpha(1)
      .alphaDecay(0.03)
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
  }, [graph, size.width, size.height])

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
      .on('zoom', (event) => setTransform(event.transform))

    select(svgEl).call(zoomBehavior).on('dblclick.zoom', null)

    return () => {
      select(svgEl).on('.zoom', null)
    }
  }, [hasMarkdownFiles])

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

  const labelOpacity = Math.max(
    LABEL_BASE_OPACITY,
    Math.min(1, (transform.k - 0.6) / (LABEL_FULL_ZOOM - 0.6))
  )

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
            <g
              ref={zoomLayerRef}
              transform={transform.toString()}
            >
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
                            ? 'stroke-amber-500/85'
                            : 'stroke-primary/80'
                          : edge.kind === 'agent-reference'
                            ? 'stroke-amber-500/35'
                            : 'stroke-foreground/15',
                        dim && 'opacity-40'
                      )}
                      strokeWidth={isHovered ? 1.5 : 1}
                      strokeLinecap="round"
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
                  const baseRadius = isFile ? NODE_RADIUS_FILE : NODE_RADIUS_AGENT
                  const radius =
                    baseRadius + (isActive ? ACTIVE_BOOST : 0) + (isHovered ? 1.5 : 0)

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
                        dim && 'opacity-35'
                      )}
                    >
                      {isActive || isHovered ? (
                        <circle
                          r={radius + 6}
                          className={cn(
                            isFile ? 'fill-primary/20' : 'fill-amber-500/20'
                          )}
                        />
                      ) : null}
                      <circle
                        r={radius}
                        className={cn(
                          isFile
                            ? isActive
                              ? 'fill-primary'
                              : 'fill-primary/85'
                            : 'fill-amber-500'
                        )}
                      />
                      <text
                        y={radius + 10}
                        textAnchor="middle"
                        style={{
                          opacity: isHovered || isActive ? 1 : labelOpacity,
                        }}
                        className="pointer-events-none fill-muted-foreground text-[9px] font-medium"
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
