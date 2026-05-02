'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Robot, SpinnerGap } from '@phosphor-icons/react'

import {
  buildKnowledgeGraph,
  type KnowledgeGraphAgentSource,
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

type PositionedKnowledgeGraphNode = KnowledgeGraphNode & {
  x: number
  y: number
}

const VIEWBOX_WIDTH = 1000
const VIEWBOX_HEIGHT = 640
const FILE_RADIUS_X = 345
const FILE_RADIUS_Y = 215
const FILE_CENTER_X = 500
const FILE_CENTER_Y = 355

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

function layoutGraphNodes(nodes: KnowledgeGraphNode[]): PositionedKnowledgeGraphNode[] {
  const agents = nodes.filter((node) => node.kind === 'agent')
  const files = nodes.filter((node) => node.kind === 'file')
  const positioned: PositionedKnowledgeGraphNode[] = []

  files.forEach((node, index) => {
    const angle = files.length <= 1
      ? -Math.PI / 2
      : (index / files.length) * Math.PI * 2 - Math.PI / 2

    positioned.push({
      ...node,
      x: files.length <= 1 ? FILE_CENTER_X : FILE_CENTER_X + Math.cos(angle) * FILE_RADIUS_X,
      y: files.length <= 1 ? FILE_CENTER_Y : FILE_CENTER_Y + Math.sin(angle) * FILE_RADIUS_Y,
    })
  })

  agents.forEach((node, index) => {
    const gap = VIEWBOX_WIDTH / (agents.length + 1)
    positioned.push({
      ...node,
      x: gap * (index + 1),
      y: 92,
    })
  })

  return positioned
}

function getNodeShortLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 21)}...` : label
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
  const positionedNodes = useMemo(() => layoutGraphNodes(graph.nodes), [graph.nodes])
  const nodeById = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node])),
    [positionedNodes]
  )

  const fileCount = graph.nodes.filter((node) => node.kind === 'file').length
  const agentCount = graph.nodes.filter((node) => node.kind === 'agent').length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-card-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-2">
        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
          <span className="px-1.5 opacity-50">·</span>
          {graph.edges.length} {graph.edges.length === 1 ? 'link' : 'links'}
          <span className="px-1.5 opacity-50">·</span>
          {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
        </p>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {markdownPaths.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <FileText size={34} className="text-muted-foreground/30" />
            <p className="max-w-[260px] text-sm text-muted-foreground">
              Add markdown files to your Knowledge Base to build the graph.
            </p>
          </div>
        ) : (
          <svg
            role="img"
            aria-label="Knowledge graph"
            className="h-full w-full"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          >
            <defs>
              <filter id="knowledge-node-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="8" stdDeviation="10" floodOpacity="0.16" />
              </filter>
            </defs>

            {graph.edges.map((edge) => {
              const source = nodeById.get(edge.source)
              const target = nodeById.get(edge.target)
              if (!source || !target) return null

              return (
                <line
                  key={edge.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className={cn(
                    edge.kind === 'agent-reference'
                      ? 'stroke-amber-500/45'
                      : 'stroke-primary/35'
                  )}
                  strokeWidth={edge.kind === 'agent-reference' ? 2.25 : 1.7}
                  strokeLinecap="round"
                />
              )
            })}

            {positionedNodes.map((node) => {
              const isFile = node.kind === 'file'
              const isActive = isFile && node.path === activeFilePath
              const radius = isFile ? 33 : 29

              return (
                <g
                  key={node.id}
                  role={isFile ? 'button' : undefined}
                  tabIndex={isFile ? 0 : undefined}
                  onClick={() => {
                    if (node.path) onOpenFile(node.path)
                  }}
                  onKeyDown={(event) => {
                    if (!node.path || (event.key !== 'Enter' && event.key !== ' ')) return
                    event.preventDefault()
                    onOpenFile(node.path)
                  }}
                  className={cn(isFile && 'cursor-pointer')}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius}
                    filter="url(#knowledge-node-shadow)"
                    className={cn(
                      isFile
                        ? isActive
                          ? 'fill-primary stroke-primary'
                          : 'fill-background stroke-primary/45'
                        : 'fill-amber-500/15 stroke-amber-500/55'
                    )}
                    strokeWidth={isActive ? 4 : 2}
                  />
                  <foreignObject x={node.x - 11} y={node.y - 11} width="22" height="22">
                    <div className="flex h-full w-full items-center justify-center">
                      {isFile ? (
                        <FileText
                          size={19}
                          weight="bold"
                          className={isActive ? 'text-primary-foreground' : 'text-primary'}
                        />
                      ) : (
                        <Robot size={18} weight="bold" className="text-amber-500" />
                      )}
                    </div>
                  </foreignObject>
                  <text
                    x={node.x}
                    y={node.y + radius + 20}
                    textAnchor="middle"
                    className="fill-foreground text-[20px] font-medium"
                  >
                    {getNodeShortLabel(node.label)}
                  </text>
                  {node.path ? (
                    <title>{node.path}</title>
                  ) : (
                    <title>{node.label}</title>
                  )}
                </g>
              )
            })}
          </svg>
        )}

        {isLoading ? (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-border/40 bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            <SpinnerGap size={11} className="animate-spin" />
            Reading markdown files
          </div>
        ) : null}

        {markdownPaths.length > 0 ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-full border border-border/40 bg-background/85 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Files
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Agents
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
