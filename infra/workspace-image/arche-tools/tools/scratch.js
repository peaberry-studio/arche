import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { getWorkspaceRoot, MAX_ATTACHMENT_FILE_BYTES, toToolOutput } from '../shared/attachment-tools.js'

const DEFAULT_SCRATCH_ROOT = '/tmp/arche-scratch'
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/
const SCRATCH_RETENTION_MS = 24 * 60 * 60 * 1000
const LAST_USED_MARKER = '.last-used'

function getScratchRoot() {
  return path.resolve(process.env.ARCHE_SCRATCH_DIR?.trim() || DEFAULT_SCRATCH_ROOT)
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// Same rules as sanitizeAttachmentFilename/ensureUniqueAttachmentFilename in
// apps/web/src/lib/workspace-attachments.ts, so published files look like uploads.
function sanitizeFilename(filename) {
  const cleaned = String(filename)
    .replace(/[/\\]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const asciiSafe = cleaned.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, '-')
  const capped = (asciiSafe || 'attachment').slice(0, 120)
  return capped === '.' || capped === '..' ? 'attachment' : capped
}

function withSuffix(name, index) {
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === name.length - 1) return `${name} (${index})`
  return `${name.slice(0, lastDot)} (${index})${name.slice(lastDot)}`
}

async function removeStaleSessionDirs(root, keep) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const cutoff = Date.now() - SCRATCH_RETENTION_MS
  await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name !== keep).map(async (entry) => {
    const target = path.join(root, entry.name)
    const stat = await fs.stat(path.join(target, LAST_USED_MARKER)).catch(() => fs.stat(target).catch(() => null))
    if (stat && stat.mtimeMs < cutoff) await fs.rm(target, { recursive: true, force: true }).catch(() => {})
  }))
}

async function ensureSessionDir(sessionID) {
  if (!SESSION_ID_PATTERN.test(sessionID ?? '')) return { ok: false, error: 'caller_identity_unavailable' }
  const root = getScratchRoot()
  const dir = path.join(root, sessionID)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  if ((await fs.lstat(dir)).isSymbolicLink()) return { ok: false, error: 'path_outside_scratch' }
  const temporaryMarker = path.join(dir, `${LAST_USED_MARKER}-${randomUUID()}`)
  await fs.writeFile(temporaryMarker, '', { flag: 'wx', mode: 0o600 })
  try {
    await fs.rename(temporaryMarker, path.join(dir, LAST_USED_MARKER))
  } finally {
    await fs.rm(temporaryMarker, { force: true })
  }
  await removeStaleSessionDirs(root, sessionID)
  return { ok: true, dir }
}

export const dir = {
  description: 'Return the private scratch folder of this session, creating it if needed. It is outside the Knowledge Base: read, write, edit files and run commands there freely, without asking. Copy Knowledge Base files or attachments into it to analyze or transform them. Files are temporary and are deleted after 24 hours or when the workspace restarts. To keep a result, publish it with scratch_publish (as a chat attachment) or propose Knowledge Base changes with learning_propose. When you delegate work on these files, pass the folder path to the subagent.',
  args: {},
  async execute(_args, context) {
    const session = await ensureSessionDir(context?.sessionID)
    if (!session.ok) return toToolOutput(session)
    return toToolOutput({ ok: true, path: session.dir, retentionHours: SCRATCH_RETENTION_MS / 3_600_000 })
  },
}

export const publish = {
  description: 'Copy a file from the scratch folder of this session into the workspace attachments, where the user can open and download it. Use it to hand over files you produced. The scratch copy is left in place.',
  args: {
    path: z.string().min(1).max(1000).describe('File inside your scratch folder, absolute or relative to it.'),
    name: z.string().min(1).max(200).optional().describe('Attachment file name; defaults to the scratch file name.'),
  },
  async execute(args, context) {
    const parsed = z.object({ path: z.string().min(1).max(1000), name: z.string().min(1).max(200).optional() }).strict().safeParse(args)
    if (!parsed.success) return toToolOutput({ ok: false, error: 'schema_validation_failed' })
    const session = await ensureSessionDir(context?.sessionID)
    if (!session.ok) return toToolOutput(session)

    const sessionDir = await fs.realpath(session.dir)
    const source = await fs.realpath(path.resolve(sessionDir, parsed.data.path)).catch(() => null)
    if (!source || !isInside(sessionDir, source)) return toToolOutput({ ok: false, error: 'path_outside_scratch' })
    const stat = await fs.stat(source)
    if (!stat.isFile()) return toToolOutput({ ok: false, error: 'not_a_file' })
    if (stat.size > MAX_ATTACHMENT_FILE_BYTES) return toToolOutput({ ok: false, error: 'file_too_large', maxBytes: MAX_ATTACHMENT_FILE_BYTES })

    const attachmentsDir = path.join(getWorkspaceRoot(), '.arche', 'attachments')
    await fs.mkdir(attachmentsDir, { recursive: true })
    const desired = sanitizeFilename(parsed.data.name ?? path.basename(source))
    for (let index = 0; index < 10_000; index++) {
      const name = index === 0 ? desired : withSuffix(desired, index)
      try {
        await fs.copyFile(source, path.join(attachmentsDir, name), fsConstants.COPYFILE_EXCL)
        return toToolOutput({ ok: true, attachment: { path: `.arche/attachments/${name}`, name, size: stat.size } })
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
    }
    return toToolOutput({ ok: false, error: 'attachment_name_unavailable' })
  },
}
