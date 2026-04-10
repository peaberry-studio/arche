import { strFromU8, unzipSync, zipSync } from 'fflate'

import { parseSkillMarkdown } from '@/lib/skills/skill-markdown'
import {
  type SkillArchive,
  type SkillBundle,
  type SkillBundleFile,
  SKILL_MARKDOWN_FILE_NAME,
} from '@/lib/skills/types'

export const MAX_SKILL_ARCHIVE_BYTES = 5 * 1024 * 1024
export const MAX_SKILL_ARCHIVE_ENTRIES = 100
export const MAX_SKILL_ARCHIVE_EXTRACTED_BYTES = 20 * 1024 * 1024
export const MAX_SKILL_ARCHIVE_FILE_BYTES = 5 * 1024 * 1024

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

function shouldIgnoreArchivePath(path: string): boolean {
  const segments = path.split('/')
  const fileName = segments[segments.length - 1] ?? ''

  return segments.includes('__MACOSX') || fileName === '.DS_Store' || fileName.startsWith('._')
}

type SkillRoot = {
  directoryPath: string
  markdownPath: string
}

function getSkillRoot(files: SkillBundleFile[]): SkillRoot | null {
  const candidates = files
    .filter((file) => {
      const segments = file.path.split('/')
      const fileName = segments[segments.length - 1] ?? ''
      return fileName.toLowerCase() === SKILL_MARKDOWN_FILE_NAME.toLowerCase()
    })
    .map((file) => {
      const separatorIndex = file.path.lastIndexOf('/')
      const directoryPath = separatorIndex === -1 ? '' : file.path.slice(0, separatorIndex)
      const fileName = separatorIndex === -1 ? file.path : file.path.slice(separatorIndex + 1)

      return {
        directoryPath,
        fileName,
        markdownPath: file.path,
        depth: directoryPath ? directoryPath.split('/').length : 0,
      }
    })
    .sort((left, right) => {
      if (left.depth !== right.depth) {
        return left.depth - right.depth
      }

      if (left.fileName !== right.fileName) {
        if (left.fileName === SKILL_MARKDOWN_FILE_NAME) {
          return -1
        }

        if (right.fileName === SKILL_MARKDOWN_FILE_NAME) {
          return 1
        }
      }

      return left.markdownPath.localeCompare(right.markdownPath)
    })

  const selected = candidates[0]
  if (!selected) {
    return null
  }

  return {
    directoryPath: selected.directoryPath,
    markdownPath: selected.markdownPath,
  }
}

function normalizeSkillFiles(files: SkillBundleFile[]): SkillBundleFile[] | null {
  const skillRoot = getSkillRoot(files)
  if (!skillRoot) {
    return null
  }

  const rootPrefix = skillRoot.directoryPath ? `${skillRoot.directoryPath}/` : ''

  return files
    .filter((file) => !rootPrefix || file.path.startsWith(rootPrefix))
    .map((file) => {
      const relativePath = rootPrefix ? file.path.slice(rootPrefix.length) : file.path

      return {
        ...file,
        path: file.path === skillRoot.markdownPath ? SKILL_MARKDOWN_FILE_NAME : relativePath,
      }
    })
}

export function parseSkillArchive(buffer: Uint8Array): ParseSkillArchiveResult {
  if (buffer.byteLength > MAX_SKILL_ARCHIVE_BYTES) {
    return { ok: false, error: 'archive_too_large' }
  }

  let extracted: Record<string, Uint8Array>
  let extractedBytes = 0
  let extractedEntryCount = 0
  let archiveTooLarge = false

  try {
    extracted = unzipSync(buffer, {
      filter: (file) => {
        if (file.name.endsWith('/')) {
          return false
        }

        extractedEntryCount += 1
        if (extractedEntryCount > MAX_SKILL_ARCHIVE_ENTRIES) {
          archiveTooLarge = true
          return false
        }

        if (file.originalSize > MAX_SKILL_ARCHIVE_FILE_BYTES) {
          archiveTooLarge = true
          return false
        }

        if (extractedBytes + file.originalSize > MAX_SKILL_ARCHIVE_EXTRACTED_BYTES) {
          archiveTooLarge = true
          return false
        }

        extractedBytes += file.originalSize
        return true
      },
    })
  } catch {
    return { ok: false, error: 'invalid_archive' }
  }

  if (archiveTooLarge) {
    return { ok: false, error: 'archive_too_large' }
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

    if (shouldIgnoreArchivePath(normalizedPath)) {
      continue
    }

    files.push({ path: normalizedPath, content })
  }

  const normalizedFiles = normalizeSkillFiles(files)
  if (!normalizedFiles) {
    return { ok: false, error: 'missing_skill_markdown' }
  }

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
