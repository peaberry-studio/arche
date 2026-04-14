import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  MAX_SKILL_ARCHIVE_FILE_BYTES,
  createSkillArchive,
  parseSkillArchive,
} from '@/lib/skills/skill-zip'

const encoder = new TextEncoder()

describe('skill-zip', () => {
  it('round-trips a skill bundle through zip export/import', () => {
    const archive = createSkillArchive({
      skill: {
        frontmatter: {
          name: 'pdf-processing',
          description: 'Handle PDF workflows',
        },
        body: '## Workflow\n',
        raw: '',
      },
      files: [
        {
          path: 'SKILL.md',
          content: encoder.encode('---\nname: pdf-processing\ndescription: Handle PDF workflows\n---\n## Workflow\n'),
        },
        {
          path: 'references/guide.md',
          content: encoder.encode('# Guide\n'),
        },
      ],
    })

    const parsed = parseSkillArchive(archive)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    expect(parsed.archive.skill.frontmatter.name).toBe('pdf-processing')
    expect(parsed.archive.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/guide.md',
    ])
  })

  it('imports a Finder zip with __MACOSX metadata', () => {
    const archive = zipSync({
      'meta-ads-spain/SKILL.md': encoder.encode('---\nname: meta-ads-spain\ndescription: Meta Ads workflows\n---\n## Workflow\n'),
      'meta-ads-spain/references/guide.md': encoder.encode('# Guide\n'),
      '__MACOSX/._meta-ads-spain': encoder.encode('resource fork'),
      '__MACOSX/meta-ads-spain/._SKILL.md': encoder.encode('resource fork'),
      '__MACOSX/meta-ads-spain/references/._guide.md': encoder.encode('resource fork'),
    })

    const parsed = parseSkillArchive(archive)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    expect(parsed.archive.skill.frontmatter.name).toBe('meta-ads-spain')
    expect(parsed.archive.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/guide.md',
    ])
  })

  it('uses the directory containing the skill markdown as the archive root', () => {
    const archive = zipSync({
      'bundle/docs/README.md': encoder.encode('# Docs\n'),
      'bundle/skills/skill.md': encoder.encode('---\nname: pdf-processing\ndescription: Handle PDF workflows\n---\n## Workflow\n'),
      'bundle/skills/references/guide.md': encoder.encode('# Guide\n'),
    })

    const parsed = parseSkillArchive(archive)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    expect(parsed.archive.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/guide.md',
    ])
  })

  it('rejects archives whose extracted content exceeds the runtime limits', () => {
    const archive = zipSync({
      'pdf-processing/SKILL.md': encoder.encode('---\nname: pdf-processing\ndescription: Handle PDF workflows\n---\n## Workflow\n'),
      'pdf-processing/references/huge.txt': encoder.encode('A'.repeat(MAX_SKILL_ARCHIVE_FILE_BYTES + 1024)),
    })

    const parsed = parseSkillArchive(archive)

    expect(parsed).toEqual({ ok: false, error: 'archive_too_large' })
  })
})
