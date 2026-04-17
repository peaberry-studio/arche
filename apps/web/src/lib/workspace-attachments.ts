import { normalizeWorkspacePath } from '@/lib/workspace-paths'

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  tsv: 'text/tab-separated-values',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  zip: 'application/zip',
}

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/tab-separated-values',
])

const DOCUMENT_MIME_TYPES = new Set([
  'application/vnd.oasis.opendocument.text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const PRESENTATION_MIME_TYPES = new Set([
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

const FALLBACK_MIME = 'text/plain'
const ATTACHMENT_DIR_PREFIX = '.arche/attachments/'

export const WORKSPACE_ATTACHMENTS_DIR = '.arche/attachments'
export const MAX_ATTACHMENT_UPLOAD_BYTES = 100 * 1024 * 1024
export const MAX_ATTACHMENT_UPLOAD_MEGABYTES = Math.floor(
  MAX_ATTACHMENT_UPLOAD_BYTES / (1024 * 1024),
)
export const MAX_ATTACHMENTS_PER_UPLOAD = 8
export const MAX_ATTACHMENTS_PER_MESSAGE = 8

export function inferAttachmentMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (!ext) return FALLBACK_MIME
  return MIME_BY_EXTENSION[ext] ?? FALLBACK_MIME
}

export function sanitizeAttachmentFilename(filename: string): string {
  const cleaned = filename
    .replace(/[/\\]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const asciiSafe = cleaned
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, '-')

  const fallback = asciiSafe.length > 0 ? asciiSafe : 'attachment'
  const capped = fallback.slice(0, 120)

  if (capped === '.' || capped === '..') return 'attachment'
  return capped
}

function splitFilename(name: string): { base: string; extension: string } {
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { base: name, extension: '' }
  }
  return {
    base: name.slice(0, lastDot),
    extension: name.slice(lastDot),
  }
}

export function ensureUniqueAttachmentFilename(
  desiredName: string,
  usedNames: Set<string>,
): string {
  if (!usedNames.has(desiredName)) return desiredName

  const { base, extension } = splitFilename(desiredName)
  let index = 1
  while (index < 10000) {
    const candidate = `${base} (${index})${extension}`
    if (!usedNames.has(candidate)) return candidate
    index += 1
  }

  return `${base}-${Date.now()}${extension}`
}

export function normalizeAttachmentPath(path: string): string {
  return normalizeWorkspacePath(path)
}

export function isWorkspaceAttachmentPath(path: string): boolean {
  const normalized = normalizeAttachmentPath(path)
  if (!normalized.startsWith(ATTACHMENT_DIR_PREFIX)) return false
  return normalized.split('/').every((segment) => segment !== '..')
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isSpreadsheetMimeType(mime: string): boolean {
  return SPREADSHEET_MIME_TYPES.has(mime.toLowerCase())
}

export function isDocumentMimeType(mime: string): boolean {
  return DOCUMENT_MIME_TYPES.has(mime.toLowerCase())
}

export function isPresentationMimeType(mime: string): boolean {
  return PRESENTATION_MIME_TYPES.has(mime.toLowerCase())
}
