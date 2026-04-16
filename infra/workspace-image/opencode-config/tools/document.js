import { z } from 'zod'

import {
  collectOfficeNodeTypeCounts,
  extractOfficeText,
  getOfficeNodeText,
  inferOfficeFormat,
  parseOfficeAttachment,
  readAttachmentBuffer,
  resolveAttachmentPath,
  toToolOutput,
  truncateExtractedText,
  visitOfficeNodes,
} from '../shared/attachment-tools.js'

const MAX_TEXT_CHARS = 24_000
const MAX_HEADINGS = 100

function resolveDocumentPath(inputPath) {
  return resolveAttachmentPath(inputPath)
}

function collectHeadings(nodes) {
  const headings = []

  visitOfficeNodes(nodes, (node) => {
    if (node.type !== 'heading' || headings.length >= MAX_HEADINGS) return

    const text = getOfficeNodeText(node)
    if (!text) return

    const level = Number.isInteger(node.metadata?.level) ? node.metadata.level : null
    headings.push({ level, text })
  })

  return headings
}
export const inspect = {
  description: 'Inspect document structure and extracted text',
  args: {
    path: z.string().describe('Path under .arche/attachments/'),
  },
  async execute(args) {
    const resolved = resolveDocumentPath(args.path)
    if (!resolved.ok) return toToolOutput(resolved)

    const fileResult = await readAttachmentBuffer(resolved.path)
    if (!fileResult.ok) return toToolOutput(fileResult)

    const parsed = await parseOfficeAttachment(fileResult.buffer)
    if (!parsed.ok) return toToolOutput(parsed)

    const textSummary = truncateExtractedText(extractOfficeText(parsed.ast), MAX_TEXT_CHARS)
    const headings = collectHeadings(parsed.ast.content)

    return toToolOutput({
      ok: true,
      path: resolved.path,
      format: inferOfficeFormat(resolved.path, parsed.ast),
      fileSize: fileResult.fileSize,
      blockCount: Array.isArray(parsed.ast.content) ? parsed.ast.content.length : 0,
      headingCount: headings.length,
      headings,
      nodeTypeCounts: collectOfficeNodeTypeCounts(parsed.ast.content),
      text: textSummary.text,
      textLength: textSummary.originalLength,
      textTruncated: textSummary.truncated,
    })
  },
}
