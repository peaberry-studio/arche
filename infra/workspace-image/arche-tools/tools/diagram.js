import { z } from 'zod'

import { toToolOutput } from '../shared/attachment-tools.js'

const MAX_TITLE_CHARS = 160
const MAX_SOURCE_CHARS = 20_000
const ALLOWED_DIAGRAM_TYPES = ['flowchart', 'graph', 'sequenceDiagram', 'mindmap']
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i
const UNSAFE_TEXT_PATTERN = /\b(?:https?:\/\/|www\.)|\b(?:javascript|data):/i
const MERMAID_DIRECTIVE_PATTERN = /%%\s*\{/i
const MERMAID_LINK_PATTERN = /^\s*click\s+|\bhref\b/im

const createArgsSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  source: z.string().min(1).max(MAX_SOURCE_CHARS),
}).strict()

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function hasUnsafeText(value) {
  return HTML_TAG_PATTERN.test(value) || UNSAFE_TEXT_PATTERN.test(value)
}

function getFirstMeaningfulLine(source) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('%%'))
}

function getDiagramType(source) {
  const firstLine = getFirstMeaningfulLine(source)
  if (!firstLine) return null

  for (const type of ALLOWED_DIAGRAM_TYPES) {
    const pattern = new RegExp(`^${type}(?:\\s|$)`)
    if (pattern.test(firstLine)) return type
  }

  return null
}

function validateMermaidSource(source) {
  if (source.length > MAX_SOURCE_CHARS) return false
  if (MERMAID_DIRECTIVE_PATTERN.test(source)) return false
  if (hasUnsafeText(source)) return false
  if (MERMAID_LINK_PATTERN.test(source)) return false
  return Boolean(getDiagramType(source))
}

function normalizeDiagramInput(input) {
  const title = normalizeLineEndings(input.title)
  const source = normalizeLineEndings(input.source)

  if (!title || title.length > MAX_TITLE_CHARS || hasUnsafeText(title)) return null
  if (!source || !validateMermaidSource(source)) return null

  return { title, source }
}

export const create = {
  description: 'Create a safe Mermaid diagram. Supported diagram types are flowchart, graph, sequenceDiagram, and mindmap. Do not use Mermaid directives, HTML labels, or external links.',
  args: {
    title: z.string().min(1).max(MAX_TITLE_CHARS).describe('Short diagram title. Plain text only.'),
    source: z.string().min(1).max(MAX_SOURCE_CHARS).describe('Mermaid source starting with flowchart, graph, sequenceDiagram, or mindmap.'),
  },
  async execute(args) {
    const parsed = createArgsSchema.safeParse(args)
    if (!parsed.success) {
      return toToolOutput({ ok: false, error: 'invalid_diagram_input' })
    }

    const diagramInput = normalizeDiagramInput(parsed.data)
    if (!diagramInput) {
      return toToolOutput({ ok: false, error: 'invalid_diagram_input' })
    }

    return toToolOutput({
      ok: true,
      format: 'arche-diagram/v1',
      diagram: {
        syntax: 'mermaid',
        title: diagramInput.title,
        source: diagramInput.source,
      },
    })
  },
}
