import path from 'node:path'

import { normalizeKbPath } from '@/lib/mcp/tools/path'
import {
  listSkills,
  readSkill,
  readSkillBundle,
} from '@/lib/skills/skill-store'

const DEFAULT_MAX_LINES = 500

export type ListSkillsResult = Awaited<ReturnType<typeof listSkills>> extends infer T ? T : never
export type ReadSkillResult = Awaited<ReturnType<typeof readSkill>> extends infer T ? T : never

export type ReadSkillResourceInput = {
  maxLines?: number
  name: string
  path: string
}

export type ReadSkillResourceResult =
  | {
      ok: true
      content: string
      hash: string | null
      kind: 'text'
      metadata: { name: string; path: string; size: number }
      truncated: boolean
    }
  | {
      ok: true
      hash: string | null
      kind: 'binary'
      metadata: { name: string; path: string; size: number }
    }
  | { ok: false; error: 'invalid_config' | 'invalid_path' | 'kb_unavailable' | 'not_found' | 'read_failed' }

export async function listSkillsForMcp(): Promise<ListSkillsResult> {
  return listSkills()
}

export async function readSkillForMcp(name: string): Promise<ReadSkillResult> {
  return readSkill(name)
}

export async function readSkillResource(
  input: ReadSkillResourceInput
): Promise<ReadSkillResourceResult> {
  const normalizedPath = normalizeKbPath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  const bundle = await readSkillBundle(input.name)
  if (!bundle.ok) {
    return bundle
  }

  const file = bundle.data.files.find((entry) => entry.path === normalizedPath)
  if (!file) {
    return { ok: false, error: 'not_found' }
  }

  const metadata = {
    name: path.basename(file.path),
    path: file.path,
    size: file.content.byteLength,
  }

  const content = decodeText(file.content)
  if (content == null) {
    return {
      ok: true,
      hash: bundle.hash,
      kind: 'binary',
      metadata,
    }
  }

  const maxLines = input.maxLines ?? DEFAULT_MAX_LINES
  const lines = toDisplayLines(content)
  if (lines.length <= maxLines) {
    return {
      ok: true,
      content,
      hash: bundle.hash,
      kind: 'text',
      metadata,
      truncated: false,
    }
  }

  const truncatedLines = lines.slice(0, maxLines)
  truncatedLines.push(`[truncated - ${lines.length} lines total]`)

  return {
    ok: true,
    content: truncatedLines.join('\n'),
    hash: bundle.hash,
    kind: 'text',
    metadata,
    truncated: true,
  }
}

function decodeText(content: Uint8Array): string | null {
  if (content.includes(0)) {
    return null
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return null
  }
}

function toDisplayLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}
