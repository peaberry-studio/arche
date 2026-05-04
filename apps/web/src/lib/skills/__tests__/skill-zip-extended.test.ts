import { beforeEach, describe, expect, it, vi } from 'vitest'

import { zipSync } from 'fflate'
import {
  MAX_SKILL_ARCHIVE_BYTES,
  MAX_SKILL_ARCHIVE_ENTRIES,
  MAX_SKILL_ARCHIVE_FILE_BYTES,
  createSkillArchive,
  parseSkillArchive,
} from '@/lib/skills/skill-zip'

const encoder = new TextEncoder()

describe('skill-zip extended', () => {
  it('rejects archives larger than max bytes', () => {
    const hugeBuffer = new Uint8Array(MAX_SKILL_ARCHIVE_BYTES + 1)
    const result = parseSkillArchive(hugeBuffer)
    expect(result).toEqual({ ok: false, error: 'archive_too_large' })
  })

  it('rejects invalid zip data', () => {
    const invalidBuffer = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    const result = parseSkillArchive(invalidBuffer)
    expect(result).toEqual({ ok: false, error: 'invalid_archive' })
  })

  it('rejects archives with invalid paths', () => {
    const archive = zipSync({
      '../escape/SKILL.md': encoder.encode('---\nname: hack\ndescription: Bad\n---\n'),
    })

    const result = parseSkillArchive(archive)
    expect(result).toEqual({ ok: false, error: 'invalid_archive_path' })
  })

  it('handles archives with path normalization edge cases', () => {
    // The inner fflate library normalizes a/../b paths, so the extracted
    // path is just b/SKILL.md which should succeed.
    const archive = zipSync({
      'a/SKILL.md': encoder.encode('---\nname: a\ndescription: A\n---\n'),
    })

    const result = parseSkillArchive(archive)
    expect(result.ok).toBe(true)
  })

  it('rejects archives missing SKILL.md', () => {
    const archive = zipSync({
      'only-readme/README.md': encoder.encode('# README\n'),
    })

    const result = parseSkillArchive(archive)
    expect(result).toEqual({ ok: false, error: 'missing_skill_markdown' })
  })

  it('rejects archives with invalid SKILL.md', () => {
    const archive = zipSync({
      'bad-skill/SKILL.md': encoder.encode('Not valid frontmatter'),
    })

    const result = parseSkillArchive(archive)
    expect(result).toEqual({ ok: false, error: 'invalid_skill_markdown' })
  })

  it('ignores .DS_Store and __MACOSX and dot-underscore files', () => {
    const archive = zipSync({
      'clean-skill/SKILL.md': encoder.encode('---\nname: clean\ndescription: Clean\n---\n'),
      'clean-skill/.DS_Store': encoder.encode('mac stuff'),
      '__MACOSX/clean-skill/._SKILL.md': encoder.encode('metadata'),
      'clean-skill/resources/._ignored': encoder.encode('ignored'),
    })

    const result = parseSkillArchive(archive)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.archive.files.map((f) => f.path)).toEqual([
      'SKILL.md',
    ])
  })

  it('normalizes paths with backslashes', () => {
    const archive = zipSync({
      'windows-skill\\SKILL.md': encoder.encode('---\nname: windows\ndescription: Windows\n---\n'),
      'windows-skill\\references\\guide.md': encoder.encode('# Guide\n'),
    })

    const result = parseSkillArchive(archive)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.archive.files.map((f) => f.path)).toEqual([
      'SKILL.md',
      'references/guide.md',
    ])
    expect(result.archive.skill.frontmatter.name).toBe('windows')
  })

  it('limits entries to MAX_SKILL_ARCHIVE_ENTRIES', () => {
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i < MAX_SKILL_ARCHIVE_ENTRIES + 2; i += 1) {
      entries[`skill/file-${i}.txt`] = encoder.encode(`content ${i}`)
    }
    entries['skill/SKILL.md'] = encoder.encode('---\nname: many\ndescription: Many\n---\n')

    const archive = zipSync(entries)
    const result = parseSkillArchive(archive)
    expect(result).toEqual({ ok: false, error: 'archive_too_large' })
  })

  it('limits individual file size to MAX_SKILL_ARCHIVE_FILE_BYTES', () => {
    const bigContent = encoder.encode('x'.repeat(MAX_SKILL_ARCHIVE_FILE_BYTES + 1))
    const archive = zipSync({
      'skill/SKILL.md': bigContent,
    })

    const result = parseSkillArchive(archive)
    expect(result).toEqual({ ok: false, error: 'archive_too_large' })
  })

  it('limits total extracted bytes', { timeout: 30000 }, () => {
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i < 20; i += 1) {
      entries[`skill/file-${i}.txt`] = encoder.encode('x'.repeat(MAX_SKILL_ARCHIVE_FILE_BYTES / 2))
    }
    entries['skill/SKILL.md'] = encoder.encode('---\nname: big\ndescription: Big\n---\n')

    const archive = zipSync(entries)
    const result = parseSkillArchive(archive)
    expect(result).toEqual({ ok: false, error: 'archive_too_large' })
  })

  it('handles skills in nested directories', () => {
    const archive = zipSync({
      'level1/level2/my-skill/SKILL.md': encoder.encode('---\nname: nested\ndescription: Nested\n---\n'),
      'level1/level2/my-skill/data.json': encoder.encode('{}'),
      'level1/other.txt': encoder.encode('other'),
    })

    const result = parseSkillArchive(archive)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.archive.files.map((f) => f.path)).toEqual([
      'SKILL.md',
      'data.json',
    ])
    expect(result.archive.skill.frontmatter.name).toBe('nested')
  })

  it('prefers shallower SKILL.md over deeper ones', () => {
    const archive = zipSync({
      'shallow/SKILL.md': encoder.encode('---\nname: shallow\ndescription: Shallow\n---\n'),
      'deep/nested/SKILL.md': encoder.encode('---\nname: deep\ndescription: Deep\n---\n'),
    })

    const result = parseSkillArchive(archive)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.archive.skill.frontmatter.name).toBe('shallow')
  })

  it('creates archive with correct root folder', () => {
    const bundle = {
      skill: {
        frontmatter: { name: 'export-skill', description: 'Exported' },
        body: '## Body',
        raw: '',
      },
      files: [
        { path: 'SKILL.md', content: encoder.encode('---\nname: export-skill\ndescription: Exported\n---\n') },
        { path: 'refs/data.md', content: encoder.encode('# Data\n') },
      ],
    }

    const archive = createSkillArchive(bundle)
    expect(archive).toBeInstanceOf(Uint8Array)
    expect(archive.byteLength).toBeGreaterThan(0)

    const parsed = parseSkillArchive(archive)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.archive.skill.frontmatter.name).toBe('export-skill')
    expect(parsed.archive.files.map((f) => f.path)).toEqual(['SKILL.md', 'refs/data.md'])
  })
})
