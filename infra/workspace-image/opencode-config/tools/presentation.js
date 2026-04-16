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
const MAX_SLIDE_TEXT_CHARS = 4_000

function resolvePresentationPath(inputPath) {
  return resolveAttachmentPath(inputPath)
}

function getSlideTitle(node) {
  if (!Array.isArray(node.children)) return null

  for (const child of node.children) {
    const text = getOfficeNodeText(child)
    if (text.length > 0) return text.split('\n')[0] || text
  }

  return null
}

function collectSlides(nodes) {
  const slides = []

  visitOfficeNodes(nodes, (node) => {
    if (node.type !== 'slide') return

    const textSummary = truncateExtractedText(getOfficeNodeText(node), MAX_SLIDE_TEXT_CHARS)

    slides.push({
      slideNumber: Number.isInteger(node.metadata?.slideNumber)
        ? node.metadata.slideNumber
        : slides.length + 1,
      title: getSlideTitle(node),
      text: textSummary.text,
      textLength: textSummary.originalLength,
      textTruncated: textSummary.truncated,
    })
  })

  return slides
}

export const inspect = {
  description: 'Inspect presentation slides and extracted text',
  args: {
    path: z.string().describe('Path under .arche/attachments/'),
  },
  async execute(args) {
    const resolved = resolvePresentationPath(args.path)
    if (!resolved.ok) return toToolOutput(resolved)

    const fileResult = await readAttachmentBuffer(resolved.path)
    if (!fileResult.ok) return toToolOutput(fileResult)

    const parsed = await parseOfficeAttachment(fileResult.buffer)
    if (!parsed.ok) return toToolOutput(parsed)

    const textSummary = truncateExtractedText(extractOfficeText(parsed.ast), MAX_TEXT_CHARS)
    const slides = collectSlides(parsed.ast.content)

    return toToolOutput({
      ok: true,
      path: resolved.path,
      format: inferOfficeFormat(resolved.path, parsed.ast),
      fileSize: fileResult.fileSize,
      slideCount: slides.length,
      slides,
      nodeTypeCounts: collectOfficeNodeTypeCounts(parsed.ast.content),
      text: textSummary.text,
      textLength: textSummary.originalLength,
      textTruncated: textSummary.truncated,
    })
  },
}
