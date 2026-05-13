import { extractPdfText, isPdfMime } from '@/lib/attachments/pdf-text-extractor'
import { isDesktop } from '@/lib/runtime/mode'
import { workspaceAgentFetch } from '@/lib/workspace-agent-client'
import {
  inferAttachmentMimeType,
  isDocumentMimeType,
  isPresentationMimeType,
  isSpreadsheetMimeType,
  isWorkspaceAttachmentPath,
} from '@/lib/workspace-attachments'
import {
  isValidContextReferencePath,
  normalizeAttachmentPath,
  normalizeWorkspacePath,
} from '@/lib/workspace-paths'

export type MessageAttachmentInput = {
  path: string
  filename?: string
  mime?: string
}

type WorkspaceAgentReadResponse = {
  ok: boolean
  content?: string
  encoding?: 'utf-8' | 'base64'
  error?: string
}

export type OpenCodePromptPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mime: string; filename?: string; url: string }

type BuildWorkspacePromptResult =
  | { ok: true; parts: OpenCodePromptPart[] }
  | { ok: false; error: string }

const MAX_PDF_BYTES_FOR_EXTRACTION = 8 * 1024 * 1024
const MAX_IMAGE_BYTES_FOR_INLINE = 8 * 1024 * 1024
const MAX_PDF_TEXT_CHARS = 24_000
const MAX_CONTEXT_REFERENCES_PER_MESSAGE = 20

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

function isImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime.toLowerCase())
}

function decodeWorkspaceAgentFileContent(data: WorkspaceAgentReadResponse): Buffer | null {
  if (typeof data.content !== 'string') return null

  if (data.encoding === 'base64') {
    try {
      return Buffer.from(data.content, 'base64')
    } catch {
      return null
    }
  }

  if (data.encoding === 'utf-8' || data.encoding === undefined) {
    return Buffer.from(data.content, 'utf-8')
  }

  return null
}

async function readWorkspaceAttachment(
  agent: { baseUrl: string; authHeader: string },
  path: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const response = await workspaceAgentFetch<WorkspaceAgentReadResponse>(agent, '/files/read', {
    path,
  })
  if (!response.ok) return null

  const decoded = decodeWorkspaceAgentFileContent(response.data)
  if (!decoded || decoded.length === 0) return null
  if (decoded.length > maxBytes) return null
  return decoded
}

function toWorkspaceFileUrl(path: string): string | null {
  if (isDesktop()) {
    return null
  }

  const encodedPath = normalizeAttachmentPath(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `file:///workspace/${encodedPath}`
}

function toAttachmentPromptPath(path: string): string {
  const normalized = normalizeAttachmentPath(path)
  return isDesktop() ? normalized : `/workspace/${normalized}`
}

function toAttachmentHintText(paths: string[]): string {
  const lines = [
    'Attached workspace files:',
    ...paths.map((path) => `- ${toAttachmentPromptPath(path)}`),
    'If direct file parsing is unavailable, inspect these paths with available tools.',
  ]
  return lines.join('\n')
}

function toContextReferenceText(paths: string[]): string {
  return [
    'Workspace context references (open files):',
    ...paths.map((path) => `@${path}`),
    'These are references only; inspect files with tools when needed.',
  ].join('\n')
}

function toPdfExtractedTextPart(path: string, text: string, truncated: boolean): string {
  const truncationNote = truncated
    ? '\n\n[The extracted content was truncated to fit the prompt window.]'
    : ''

  return [
    `Extracted text from attached PDF: ${toAttachmentPromptPath(path)}`,
    text,
    truncationNote,
  ]
    .filter((segment) => segment.length > 0)
    .join('\n\n')
}

function toPdfExtractionFailureText(path: string): string {
  return [
    `Attached PDF could not be extracted automatically: ${toAttachmentPromptPath(path)}`,
    'Continue by using available tools on this path, or ask the user for an OCR-friendly/text PDF if the file is scanned.',
  ].join('\n')
}

function toSpreadsheetToolHintText(path: string): string {
  return [
    `Attached spreadsheet file: ${toAttachmentPromptPath(path)}`,
    'You must use spreadsheet_inspect first to detect sheets and columns, then use spreadsheet_sample/spreadsheet_query/spreadsheet_stats for focused analysis and calculations.',
  ].join('\n')
}

function toDocumentToolHintText(path: string): string {
  return [
    `Attached document file: ${toAttachmentPromptPath(path)}`,
    'Use document_inspect to extract the structure, headings, and normalized text before answering detailed questions about the document.',
  ].join('\n')
}

function toPresentationToolHintText(path: string): string {
  return [
    `Attached presentation file: ${toAttachmentPromptPath(path)}`,
    'Use presentation_inspect to inspect slide structure and extracted slide text before summarizing or comparing the deck.',
  ].join('\n')
}

export function normalizeContextPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const unique = new Set<string>()
  const normalized: string[] = []

  for (const item of value) {
    if (typeof item !== 'string') continue
    const path = normalizeWorkspacePath(item.trim())
    if (!isValidContextReferencePath(path) || unique.has(path)) continue

    unique.add(path)
    normalized.push(path)

    if (normalized.length >= MAX_CONTEXT_REFERENCES_PER_MESSAGE) {
      break
    }
  }

  return normalized
}

export function normalizeMessageAttachments(value: unknown): MessageAttachmentInput[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      path: typeof item.path === 'string' ? normalizeAttachmentPath(item.path) : '',
      filename: typeof item.filename === 'string' ? item.filename : undefined,
      mime: typeof item.mime === 'string' ? item.mime : undefined,
    }))
    .filter((item) => item.path.length > 0)
}

export async function buildWorkspacePromptParts(params: {
  agent: { baseUrl: string; authHeader: string }
  attachments: MessageAttachmentInput[]
  contextPaths: string[]
  text?: string
}): Promise<BuildWorkspacePromptResult> {
  const promptParts: OpenCodePromptPart[] = []

  if (typeof params.text === 'string' && params.text.trim().length > 0) {
    promptParts.push({ type: 'text', text: params.text })
  }

  if (params.contextPaths.length > 0) {
    promptParts.push({
      type: 'text',
      text: toContextReferenceText(params.contextPaths),
    })
  }

  if (params.attachments.length > 0) {
    const attachmentPathsForHint: string[] = []

    for (const attachment of params.attachments) {
      const attachmentPath = normalizeAttachmentPath(attachment.path)

      if (!isWorkspaceAttachmentPath(attachmentPath)) {
        return { ok: false, error: 'invalid_attachment_path' }
      }

      const fileName =
        attachment.filename ??
        attachmentPath.split('/').pop() ??
        'attachment'
      const attachmentMime = attachment.mime?.trim()
      const mime =
        attachmentMime &&
        attachmentMime.length > 0 &&
        attachmentMime !== 'application/octet-stream'
          ? attachmentMime
          : inferAttachmentMimeType(fileName)

      if (isPdfMime(mime)) {
        const attachmentBytes = await readWorkspaceAttachment(
          params.agent,
          attachmentPath,
          MAX_PDF_BYTES_FOR_EXTRACTION,
        )

        if (attachmentBytes) {
          const extracted = await extractPdfText(attachmentBytes, MAX_PDF_TEXT_CHARS)
          promptParts.push({
            type: 'text',
            text: extracted.ok
              ? toPdfExtractedTextPart(attachmentPath, extracted.text, extracted.truncated)
              : toPdfExtractionFailureText(attachmentPath),
          })
        } else {
          promptParts.push({
            type: 'text',
            text: toPdfExtractionFailureText(attachmentPath),
          })
        }

        attachmentPathsForHint.push(attachmentPath)
        continue
      }

      if (isSpreadsheetMimeType(mime)) {
        promptParts.push({ type: 'text', text: toSpreadsheetToolHintText(attachmentPath) })
        attachmentPathsForHint.push(attachmentPath)
        continue
      }

      if (isDocumentMimeType(mime)) {
        promptParts.push({ type: 'text', text: toDocumentToolHintText(attachmentPath) })
        attachmentPathsForHint.push(attachmentPath)
        continue
      }

      if (isPresentationMimeType(mime)) {
        promptParts.push({ type: 'text', text: toPresentationToolHintText(attachmentPath) })
        attachmentPathsForHint.push(attachmentPath)
        continue
      }

      if (isImageMime(mime)) {
        const imageBytes = await readWorkspaceAttachment(
          params.agent,
          attachmentPath,
          MAX_IMAGE_BYTES_FOR_INLINE,
        )
        const workspaceFileUrl = toWorkspaceFileUrl(attachmentPath)

        if (imageBytes) {
          promptParts.push({
            type: 'file',
            mime,
            filename: fileName,
            url: `data:${mime};base64,${imageBytes.toString('base64')}`,
          })
        } else if (workspaceFileUrl) {
          promptParts.push({
            type: 'file',
            mime,
            filename: fileName,
            url: workspaceFileUrl,
          })
        }

        attachmentPathsForHint.push(attachmentPath)
        continue
      }

      const workspaceFileUrl = toWorkspaceFileUrl(attachmentPath)
      if (workspaceFileUrl) {
        promptParts.push({
          type: 'file',
          mime,
          filename: fileName,
          url: workspaceFileUrl,
        })
      }

      attachmentPathsForHint.push(attachmentPath)
    }

    if (attachmentPathsForHint.length > 0) {
      promptParts.push({
        type: 'text',
        text: toAttachmentHintText(attachmentPathsForHint),
      })
    }
  }

  if (promptParts.length === 0) {
    return { ok: false, error: 'missing_fields' }
  }

  return { ok: true, parts: promptParts }
}
