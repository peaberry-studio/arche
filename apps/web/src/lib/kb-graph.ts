import {
  findObsidianLinks,
  resolveObsidianLinkTarget,
} from '@/lib/kb-internal-links'

export type KnowledgeGraphAgentSource = {
  id: string
  displayName: string
  prompt?: string
}

export type KnowledgeGraphFileSource = {
  path: string
  content?: string
}

export type KnowledgeGraphNode = {
  id: string
  kind: 'agent' | 'file'
  label: string
  path?: string
  agentId?: string
}

export type KnowledgeGraphEdge = {
  id: string
  kind: 'agent-reference' | 'file-link'
  source: string
  target: string
}

export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
}

type BuildKnowledgeGraphArgs = {
  agents?: KnowledgeGraphAgentSource[]
  files: KnowledgeGraphFileSource[]
}

function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

function stripMarkdownExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

function getFileLabel(path: string): string {
  const basename = path.split('/').pop() ?? path
  return stripMarkdownExtension(basename) || path
}

function fileNodeId(path: string): string {
  return `file:${path}`
}

function agentNodeId(id: string): string {
  return `agent:${id}`
}

function uniqueNormalizedPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizePath).filter(Boolean))).sort()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasRawPathReference(content: string, path: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_./-])${escapeRegExp(path)}(?=$|[^A-Za-z0-9_./-])`
  )
  return pattern.test(content)
}

function collectWikilinkReferences(content: string, availablePaths: string[]): string[] {
  const references = new Set<string>()

  for (const link of findObsidianLinks(content)) {
    const resolved = resolveObsidianLinkTarget(link.target, availablePaths)
    if (resolved) references.add(normalizePath(resolved))
  }

  return Array.from(references)
}

function collectRawPathReferences(content: string, availablePaths: string[]): string[] {
  const normalizedContent = content.replace(/\\/g, '/')
  return availablePaths.filter((path) => hasRawPathReference(normalizedContent, path))
}

const MARKDOWN_LINK_REGEX = /\[[^\]\n]*\]\(([^)\s]+)\)/g

function collectMarkdownLinkReferences(content: string, availablePaths: string[]): string[] {
  const references = new Set<string>()
  for (const match of content.matchAll(MARKDOWN_LINK_REGEX)) {
    const target = match[1]?.split('#')[0]?.trim()
    if (!target) continue
    const resolved = resolveObsidianLinkTarget(target, availablePaths)
    if (resolved) references.add(normalizePath(resolved))
  }
  return Array.from(references)
}

export function buildKnowledgeGraph({
  agents = [],
  files,
}: BuildKnowledgeGraphArgs): KnowledgeGraph {
  const filePaths = uniqueNormalizedPaths(files.map((file) => file.path))
  const fileContentByPath = new Map(
    files.map((file) => [normalizePath(file.path), file.content ?? ''])
  )

  const nodes: KnowledgeGraphNode[] = filePaths.map((path) => ({
    id: fileNodeId(path),
    kind: 'file',
    label: getFileLabel(path),
    path,
  }))
  const edges: KnowledgeGraphEdge[] = []
  const edgeIds = new Set<string>()

  function addEdge(kind: KnowledgeGraphEdge['kind'], source: string, target: string) {
    if (source === target) return

    const id = `${kind}:${source}->${target}`
    if (edgeIds.has(id)) return

    edgeIds.add(id)
    edges.push({ id, kind, source, target })
  }

  for (const sourcePath of filePaths) {
    const content = fileContentByPath.get(sourcePath) ?? ''
    const references = new Set([
      ...collectWikilinkReferences(content, filePaths),
      ...collectMarkdownLinkReferences(content, filePaths),
    ])
    for (const targetPath of references) {
      addEdge('file-link', fileNodeId(sourcePath), fileNodeId(targetPath))
    }
  }

  for (const agent of agents) {
    const prompt = agent.prompt ?? ''
    const references = new Set([
      ...collectWikilinkReferences(prompt, filePaths),
      ...collectMarkdownLinkReferences(prompt, filePaths),
      ...collectRawPathReferences(prompt, filePaths),
    ])

    const source = agentNodeId(agent.id)
    nodes.push({
      id: source,
      kind: 'agent',
      label: agent.displayName,
      agentId: agent.id,
    })

    for (const targetPath of references) {
      addEdge('agent-reference', source, fileNodeId(targetPath))
    }
  }

  return { nodes, edges }
}
