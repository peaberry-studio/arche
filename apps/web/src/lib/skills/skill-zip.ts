import { strFromU8, unzipSync, zipSync } from 'fflate'

import { parseSkillMarkdown } from '@/lib/skills/skill-markdown'
import {
  type SkillArchive,
  type SkillBundle,
  type SkillBundleFile,
  SKILL_MARKDOWN_FILE_NAME,
} from '@/lib/skills/types'

export const MAX_SKILL_ARCHIVE_BYTES = 5 * 1024 * 1024

type ParseSkillArchiveResult =
  | { ok: true; archive: SkillArchive }
  | {
      ok: false
      error:
        | 'archive_too_large'
        | 'invalid_archive'
        | 'invalid_archive_path'
        | 'invalid_skill_markdown'
        | 'missing_skill_markdown'
    }

function normalizeArchivePath(input: string): string | null {
  const normalized = input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')

  const segments = normalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return null
  }

  return segments.join('/')
}

function stripCommonRoot(files: SkillBundleFile[]): SkillBundleFile[] {
  const firstSegments = Array.from(new Set(files.map((file) => file.path.split('/')[0])))
  if (firstSegments.length !== 1) {
    return files
  }

  const [rootSegment] = firstSegments
  const skillMarkdownPath = `${rootSegment}/${SKILL_MARKDOWN_FILE_NAME}`
  if (!files.some((file) => file.path === skillMarkdownPath)) {
    return files
  }

  return files.map((file) => ({
    ...file,
    path: file.path.slice(rootSegment.length + 1),
  }))
}

export function parseSkillArchive(buffer: Uint8Array): ParseSkillArchiveResult {
  if (buffer.byteLength > MAX_SKILL_ARCHIVE_BYTES) {
    return { ok: false, error: 'archive_too_large' }
  }

  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(buffer)
  } catch {
    return { ok: false, error: 'invalid_archive' }
  }

  const files: SkillBundleFile[] = []
  for (const [entryPath, content] of Object.entries(extracted)) {
    if (entryPath.endsWith('/')) {
      continue
    }

    const normalizedPath = normalizeArchivePath(entryPath)
    if (!normalizedPath) {
      return { ok: false, error: 'invalid_archive_path' }
    }

    files.push({ path: normalizedPath, content })
  }

  const normalizedFiles = stripCommonRoot(files)
  const skillMarkdown = normalizedFiles.find((file) => file.path === SKILL_MARKDOWN_FILE_NAME)
  if (!skillMarkdown) {
    return { ok: false, error: 'missing_skill_markdown' }
  }

  const parsed = parseSkillMarkdown(strFromU8(skillMarkdown.content))
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_skill_markdown' }
  }

  return {
    ok: true,
    archive: {
      files: normalizedFiles,
      skill: parsed.skill,
    },
  }
}

export function createSkillArchive(bundle: SkillBundle): Uint8Array {
  const rootDirectory = bundle.skill.frontmatter.name
  const archiveEntries: Record<string, Uint8Array> = {}

  for (const file of bundle.files) {
    archiveEntries[`${rootDirectory}/${file.path}`] = file.content
  }

  return zipSync(archiveEntries, { level: 0 })
}
