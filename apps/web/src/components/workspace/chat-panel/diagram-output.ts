import { isRecord } from '@/lib/records'

const MAX_TITLE_CHARS = 160
const MAX_SOURCE_CHARS = 20_000
const ALLOWED_DIAGRAM_TYPES = ['flowchart', 'graph', 'sequenceDiagram', 'mindmap']
const URL_PATTERN = /\b(?:https?:\/\/|www\.)|\b(?:javascript|data):/i
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i
const MERMAID_DIRECTIVE_PATTERN = /%%\s*\{/i
const MERMAID_LINK_PATTERN = /^\s*click\s+|\bhref\b/im

export type DiagramOutput = {
  syntax: 'mermaid'
  title: string
  source: string
}

const getString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

function getSafeString(value: unknown, maxChars: number): string | undefined {
  const text = getString(value)
  if (!text || text.length > maxChars) return undefined
  if (HTML_TAG_PATTERN.test(text) || URL_PATTERN.test(text)) return undefined
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function getFirstMeaningfulLine(source: string): string | undefined {
  return source
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('%%'))
}

function isAllowedMermaidType(source: string): boolean {
  const firstLine = getFirstMeaningfulLine(source)
  if (!firstLine) return false

  return ALLOWED_DIAGRAM_TYPES.some((type) => new RegExp(`^${type}(?:\\s|$)`).test(firstLine))
}

export function hasBlockedMermaidSyntax(source: string): boolean {
  return (
    source.length > MAX_SOURCE_CHARS ||
    MERMAID_DIRECTIVE_PATTERN.test(source) ||
    MERMAID_LINK_PATTERN.test(source) ||
    HTML_TAG_PATTERN.test(source) ||
    URL_PATTERN.test(source) ||
    !isAllowedMermaidType(source)
  )
}

export function parseDiagramOutput(rawOutput?: string): DiagramOutput | null {
  const source = rawOutput?.trim()
  if (!source) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  if (!isRecord(parsed) || parsed.ok !== true || parsed.format !== 'arche-diagram/v1') return null
  if (!isRecord(parsed.diagram)) return null
  if (parsed.diagram.syntax !== 'mermaid') return null

  const title = getSafeString(parsed.diagram.title, MAX_TITLE_CHARS)
  const diagramSource = getSafeString(parsed.diagram.source, MAX_SOURCE_CHARS)
  if (!title || !diagramSource) return null
  if (hasBlockedMermaidSyntax(diagramSource)) return null

  return { syntax: 'mermaid', title, source: diagramSource }
}
