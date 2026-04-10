import { describe, expect, it } from 'vitest'

import { createSkillArchive, parseSkillArchive } from '@/lib/skills/skill-zip'

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
          content: new TextEncoder().encode('---\nname: pdf-processing\ndescription: Handle PDF workflows\n---\n## Workflow\n'),
        },
        {
          path: 'references/guide.md',
          content: new TextEncoder().encode('# Guide\n'),
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
})
