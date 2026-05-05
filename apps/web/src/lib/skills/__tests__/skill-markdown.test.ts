import { describe, expect, it } from 'vitest'

import { createSkillMarkdown, parseSkillMarkdown, serializeSkillMarkdown } from '@/lib/skills/skill-markdown'

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

  it('supports BOM input, CRLF line endings, and ellipsis frontmatter delimiters', () => {
    const result = parseSkillMarkdown('\uFEFF---\r\nname: writer\r\ndescription: Draft copy\r\n...\r\nBody\r\n')

    expect(result).toEqual({
      ok: true,
      skill: {
        frontmatter: {
          name: 'writer',
          description: 'Draft copy',
        },
        body: 'Body\n',
        raw: '\uFEFF---\nname: writer\ndescription: Draft copy\n...\nBody\n',
      },
    })
  })

  it.each([
    ['missing_frontmatter', 'name: writer\ndescription: Draft copy\n'],
    ['missing_frontmatter', '---\nname: writer\ndescription: Draft copy\n'],
    ['invalid_yaml', '---\nname: [unterminated\n---\n'],
    ['invalid_frontmatter', '---\n[]\n---\n'],
    ['invalid_frontmatter', '---\nname:\n  - writer\ndescription: Draft copy\n---\n'],
    ['invalid_frontmatter', '---\nname: writer\n---\n'],
    ['invalid_frontmatter', '---\nname: writer\ndescription: Draft copy\nlicense: 123\n---\n'],
    ['invalid_frontmatter', '---\nname: writer\ndescription: Draft copy\ncompatibility: 123\n---\n'],
    ['invalid_frontmatter', `---\nname: writer\ndescription: Draft copy\ncompatibility: ${'a'.repeat(501)}\n---\n`],
    ['invalid_metadata', '---\nname: writer\ndescription: Draft copy\nmetadata: []\n---\n'],
    ['invalid_metadata', '---\nname: writer\ndescription: Draft copy\nmetadata:\n  author: 3\n---\n'],
    ['missing_name', '---\nname: "   "\ndescription: Draft copy\n---\n'],
    ['invalid_name', '---\nname: Bad Name!\ndescription: Draft copy\n---\n'],
    ['missing_description', '---\nname: writer\ndescription: "   "\n---\n'],
    ['invalid_description', `---\nname: writer\ndescription: ${'a'.repeat(1025)}\n---\n`],
  ])('returns %s for invalid skill markdown', (error, markdown) => {
    expect(parseSkillMarkdown(markdown)).toEqual({ ok: false, error })
  })

  it('rejects valid markdown when the expected name differs', () => {
    expect(parseSkillMarkdown('---\nname: writer\ndescription: Draft copy\n---\n', 'analyst')).toEqual({
      ok: false,
      error: 'name_mismatch',
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

  it('serializes frontmatter with trimmed names and normalized body line endings', () => {
    expect(serializeSkillMarkdown({
      body: 'Line 1\r\nLine 2\r',
      frontmatter: {
        name: ' writer ',
        description: '  Draft copy  ',
        metadata: { author: 'arche' },
      },
    })).toBe('---\nname: writer\ndescription: Draft copy\nmetadata:\n  author: arche\n---\nLine 1\nLine 2\n')
  })
})
