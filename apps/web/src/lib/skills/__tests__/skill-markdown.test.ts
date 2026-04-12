import { describe, expect, it } from 'vitest'

import { createSkillMarkdown, parseSkillMarkdown } from '@/lib/skills/skill-markdown'

describe('skill-markdown', () => {
  it('parses a valid SKILL.md document', () => {
    const result = parseSkillMarkdown(`---\nname: pdf-processing\ndescription: Handle PDF workflows\nmetadata:\n  author: arche\n---\n# PDF\n`)

    expect(result).toEqual({
      ok: true,
      skill: {
        frontmatter: {
          name: 'pdf-processing',
          description: 'Handle PDF workflows',
          metadata: {
            author: 'arche',
          },
        },
        body: '# PDF\n',
        raw: '---\nname: pdf-processing\ndescription: Handle PDF workflows\nmetadata:\n  author: arche\n---\n# PDF\n',
      },
    })
  })

  it('serializes updated content while preserving existing frontmatter fields', () => {
    const markdown = createSkillMarkdown({
      name: 'pdf-processing',
      description: 'Updated description',
      body: '## Workflow\n',
      existingFrontmatter: {
        name: 'pdf-processing',
        description: 'Old description',
        compatibility: 'Requires python',
      },
    })

    expect(markdown).toContain('name: pdf-processing')
    expect(markdown).toContain('description: Updated description')
    expect(markdown).toContain('compatibility: Requires python')
    expect(markdown).toContain('## Workflow')
  })
})
