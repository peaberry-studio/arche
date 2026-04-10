import { Document, isMap, isScalar, parseDocument } from 'yaml'

import {
  type SkillDocument,
  type SkillFrontmatter,
  SKILL_NAME_PATTERN,
} from '@/lib/skills/types'

type ParseSkillMarkdownResult =
  | { ok: true; skill: SkillDocument }
  | {
      ok: false
      error:
        | 'invalid_description'
        | 'invalid_frontmatter'
        | 'invalid_metadata'
        | 'invalid_name'
        | 'invalid_yaml'
        | 'missing_description'
        | 'missing_frontmatter'
        | 'missing_name'
        | 'name_mismatch'
    }

type SplitFrontmatterResult =
  | { ok: true; body: string; frontmatter: string }
  | { ok: false; error: 'missing_frontmatter' }

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, '\n')
}

function splitFrontmatter(value: string): SplitFrontmatterResult {
  const normalized = normalizeLineEndings(value)
  const source = normalized.startsWith('\uFEFF') ? normalized.slice(1) : normalized
  const lines = source.split('\n')

  if (lines[0] !== '---') {
    return { ok: false, error: 'missing_frontmatter' }
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] !== '---' && lines[index] !== '...') {
      continue
    }

    return {
      ok: true,
      frontmatter: lines.slice(1, index).join('\n'),
      body: lines.slice(index + 1).join('\n'),
    }
  }

  return { ok: false, error: 'missing_frontmatter' }
}

function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && SKILL_NAME_PATTERN.test(name)
}

function normalizeFrontmatter(value: unknown): SkillFrontmatter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const frontmatter = { ...(value as Record<string, unknown>) }

  if (typeof frontmatter.name !== 'string') {
    return null
  }

  if (typeof frontmatter.description !== 'string') {
    return null
  }

  if (frontmatter.license != null && typeof frontmatter.license !== 'string') {
    return null
  }

  if (frontmatter.compatibility != null && typeof frontmatter.compatibility !== 'string') {
    return null
  }

  if (frontmatter.metadata != null) {
    if (!frontmatter.metadata || typeof frontmatter.metadata !== 'object' || Array.isArray(frontmatter.metadata)) {
      return null
    }

    const metadataEntries = Object.entries(frontmatter.metadata as Record<string, unknown>)
    if (metadataEntries.some(([key, entry]) => !key || typeof entry !== 'string')) {
      return null
    }
  }

  return frontmatter as SkillFrontmatter
}

export function parseSkillMarkdown(value: string, expectedName?: string): ParseSkillMarkdownResult {
  const split = splitFrontmatter(value)
  if (!split.ok) {
    return split
  }

  const document = parseDocument(split.frontmatter, {
    prettyErrors: false,
    strict: false,
  })

  if (document.errors.length > 0) {
    return { ok: false, error: 'invalid_yaml' }
  }

  if (!document.contents || !isMap(document.contents)) {
    return { ok: false, error: 'invalid_frontmatter' }
  }

  const normalized = normalizeFrontmatter(document.toJS())
  if (!normalized) {
    const metadataItem = document.contents.items.find((item) => {
      if (!isScalar(item.key) || item.key.value !== 'metadata') return false
      return true
    })

    return { ok: false, error: metadataItem ? 'invalid_metadata' : 'invalid_frontmatter' }
  }

  const name = normalized.name.trim()
  if (!name) {
    return { ok: false, error: 'missing_name' }
  }

  if (!isValidSkillName(name)) {
    return { ok: false, error: 'invalid_name' }
  }

  if (expectedName && expectedName !== name) {
    return { ok: false, error: 'name_mismatch' }
  }

  const description = normalized.description.trim()
  if (!description) {
    return { ok: false, error: 'missing_description' }
  }

  if (description.length > 1024) {
    return { ok: false, error: 'invalid_description' }
  }

  if (normalized.compatibility && normalized.compatibility.length > 500) {
    return { ok: false, error: 'invalid_frontmatter' }
  }

  return {
    ok: true,
    skill: {
      frontmatter: {
        ...normalized,
        name,
        description,
      },
      body: split.body,
      raw: normalizeLineEndings(value),
    },
  }
}

export function serializeSkillMarkdown(skill: Pick<SkillDocument, 'body' | 'frontmatter'>): string {
  const frontmatter: SkillFrontmatter = {
    ...skill.frontmatter,
    name: skill.frontmatter.name.trim(),
    description: skill.frontmatter.description.trim(),
  }

  const document = new Document(frontmatter)
  const frontmatterContent = String(document).trimEnd()
  const body = normalizeLineEndings(skill.body)

  return `---\n${frontmatterContent}\n---\n${body}`
}

export function createSkillMarkdown(input: {
  body: string
  description: string
  existingFrontmatter?: SkillFrontmatter
  name: string
}): string {
  return serializeSkillMarkdown({
    body: input.body,
    frontmatter: {
      ...input.existingFrontmatter,
      name: input.name,
      description: input.description,
    },
  })
}
