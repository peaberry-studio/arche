import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024

const DEFAULT_WORKSPACE_ROOT = '/workspace'

let parseOfficePromise = null

export function getWorkspaceRoot() {
  return path.resolve(process.env.WORKSPACE_DIR?.trim() || DEFAULT_WORKSPACE_ROOT)
}

function getAttachmentsRoot() {
  return path.join(getWorkspaceRoot(), '.arche', 'attachments')
}

export function toToolOutput(value) {
  return JSON.stringify(value, null, 2)
}

function normalizeAttachmentPath(inputPath) {
  const trimmed = String(inputPath || '').trim()
  if (!trimmed) return null

  if (trimmed.startsWith('file://')) {
    try {
      return path.resolve(fileURLToPath(trimmed))
    } catch {
      return null
    }
  }

  const normalized = trimmed.replace(/\\/g, '/')
  if (normalized.startsWith('/workspace/')) {
    return path.resolve(getWorkspaceRoot(), normalized.slice('/workspace/'.length))
  }

  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed)
  }

  const relative = normalized.replace(/^\.\//, '').replace(/^\/+/, '')
  return path.resolve(getWorkspaceRoot(), relative)
}

export function resolveAttachmentPath(inputPath) {
  const candidate = normalizeAttachmentPath(inputPath)
  if (!candidate) return { ok: false, error: 'invalid_path' }

  const absolute = path.resolve(candidate)
  const relativeToAttachments = path.relative(getAttachmentsRoot(), absolute)
  if (
    relativeToAttachments === '..' ||
    relativeToAttachments.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToAttachments)
  ) {
    return { ok: false, error: 'path_outside_attachments' }
  }

  return { ok: true, path: absolute }
}

export async function readAttachmentBuffer(filePath, maxBytes = MAX_ATTACHMENT_FILE_BYTES) {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return { ok: false, error: 'file_not_found' }
  }

  if (!stat.isFile()) return { ok: false, error: 'not_a_file' }
  if (stat.size > maxBytes) return { ok: false, error: 'file_too_large' }

  try {
    const buffer = await fs.readFile(filePath)
    return { ok: true, buffer, fileSize: stat.size }
  } catch {
    return { ok: false, error: 'file_read_failed' }
  }
}

export function normalizeExtractedText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
}

export function truncateExtractedText(text, maxChars) {
  const normalized = normalizeExtractedText(text)

  if (maxChars <= 0 || normalized.length <= maxChars) {
    return {
      text: normalized,
      truncated: false,
      originalLength: normalized.length,
    }
  }

  return {
    text: `${normalized.slice(0, maxChars)}\n\n[truncated]`,
    truncated: true,
    originalLength: normalized.length,
  }
}

function isOfficeNode(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function visitOfficeNodes(nodes, visit) {
  if (!Array.isArray(nodes)) return

  for (const node of nodes) {
    if (!isOfficeNode(node)) continue

    visit(node)

    if (Array.isArray(node.children)) {
      visitOfficeNodes(node.children, visit)
    }
  }
}

export function getOfficeNodeText(node) {
  if (!isOfficeNode(node)) return ''

  if (typeof node.text === 'string') {
    return normalizeExtractedText(node.text)
  }

  const childTexts = Array.isArray(node.children)
    ? node.children
      .map((child) => getOfficeNodeText(child))
      .filter((text) => text.length > 0)
    : []

  return normalizeExtractedText(childTexts.join('\n'))
}

export function inferOfficeFormat(filePath, ast) {
  if (typeof ast?.type === 'string' && ast.type.trim().length > 0) {
    return ast.type.trim().toLowerCase()
  }

  return path.extname(filePath).slice(1).toLowerCase() || 'unknown'
}

export function collectOfficeNodeTypeCounts(nodes) {
  const counts = new Map()

  visitOfficeNodes(nodes, (node) => {
    const type = typeof node.type === 'string' && node.type.trim().length > 0
      ? node.type.trim()
      : 'unknown'

    counts.set(type, (counts.get(type) || 0) + 1)
  })

  return Object.fromEntries(Array.from(counts.entries()).sort((left, right) => left[0].localeCompare(right[0])))
}

export function extractOfficeText(ast) {
  if (typeof ast?.toText === 'function') {
    return ast.toText()
  }

  return Array.isArray(ast?.content)
    ? ast.content.map((node) => getOfficeNodeText(node)).filter((text) => text.length > 0).join('\n')
    : ''
}

async function loadParseOffice() {
  if (!parseOfficePromise) {
    parseOfficePromise = import('officeparser')
      .then((module) => {
        const parseOffice = module.OfficeParser?.parseOffice
          || module.parseOffice
          || module.default?.parseOffice

        return typeof parseOffice === 'function' ? parseOffice : null
      })
      .catch(() => null)
  }

  return parseOfficePromise
}

export async function parseOfficeAttachment(input) {
  const parseOffice = await loadParseOffice()
  if (!parseOffice) {
    return { ok: false, error: 'office_parser_unavailable' }
  }

  try {
    const ast = await parseOffice(input)
    return { ok: true, ast }
  } catch {
    return { ok: false, error: 'unsupported_or_corrupted_office_file' }
  }
}
