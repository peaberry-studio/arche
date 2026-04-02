import path from 'node:path'

import { runGitOnBareRepo } from '@/lib/git/bare-repo'
import { normalizeKbPath } from '@/lib/mcp/tools/path'
import { getKbContentRoot } from '@/lib/runtime/paths'

const DEFAULT_MAX_LINES = 500
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.yaml', '.yml'])

export type ReadKbArticleInput = {
  path: string
  maxLines?: number
}

export type ReadKbArticleResult =
  | { ok: true; kind: 'text'; content: string; truncated: boolean }
  | { ok: true; kind: 'binary'; metadata: { name: string; path: string; size: number | null } }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'not_found' }

export async function readKbArticle(
  input: ReadKbArticleInput
): Promise<ReadKbArticleResult> {
  const normalizedPath = normalizeKbPath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  if (!isTextExtension(normalizedPath)) {
    return readBinaryMetadata(normalizedPath)
  }

  const result = await runGitOnBareRepo(getKbContentRoot(), ['show', `HEAD:${normalizedPath}`])
  if (!result.ok) {
    return mapGitError(result.stderr)
  }

  const maxLines = input.maxLines ?? DEFAULT_MAX_LINES
  const lines = toDisplayLines(result.stdout)
  if (lines.length <= maxLines) {
    return {
      ok: true,
      kind: 'text',
      content: result.stdout,
      truncated: false,
    }
  }

  const truncatedLines = lines.slice(0, maxLines)
  truncatedLines.push(`[truncated - ${lines.length} lines total]`)

  return {
    ok: true,
    kind: 'text',
    content: truncatedLines.join('\n'),
    truncated: true,
  }
}

async function readBinaryMetadata(filePath: string): Promise<ReadKbArticleResult> {
  const result = await runGitOnBareRepo(getKbContentRoot(), ['cat-file', '-s', `HEAD:${filePath}`])
  if (!result.ok) {
    return mapGitError(result.stderr)
  }

  const size = Number.parseInt(result.stdout.trim(), 10)

  return {
    ok: true,
    kind: 'binary',
    metadata: {
      name: path.basename(filePath),
      path: filePath,
      size: Number.isFinite(size) ? size : null,
    },
  }
}

function isTextExtension(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function toDisplayLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

function mapGitError(stderr: string): { ok: false; error: 'kb_unavailable' | 'not_found' } {
  if (stderr.includes('path') || stderr.includes('exists on disk')) {
    return { ok: false, error: 'not_found' }
  }

  return { ok: false, error: 'kb_unavailable' }
}
