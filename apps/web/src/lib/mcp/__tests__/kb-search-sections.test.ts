import { describe, expect, it } from 'vitest'

import { splitArticleIntoSections, tokenize } from '@/lib/mcp/kb-search-sections'

describe('splitArticleIntoSections', () => {
  it('splits at headings and records heading trail and start line', () => {
    const content = [
      '# Arche',
      'Platform intro.',
      '',
      '## Tech Stack',
      'Next.js and Postgres.',
      '### Deploy',
      'Ansible on a VPS.',
    ].join('\n')

    expect(splitArticleIntoSections('Proyectos/Arche/00 - Arche.md', content)).toEqual([
      { path: 'Proyectos/Arche/00 - Arche.md', heading: 'Arche', line: 1, text: 'Platform intro.' },
      { path: 'Proyectos/Arche/00 - Arche.md', heading: 'Arche › Tech Stack', line: 4, text: 'Next.js and Postgres.' },
      { path: 'Proyectos/Arche/00 - Arche.md', heading: 'Arche › Tech Stack › Deploy', line: 6, text: 'Ansible on a VPS.' },
    ])
  })

  it('keeps text before the first heading under an empty heading', () => {
    expect(splitArticleIntoSections('a.md', 'Preamble.\n# Title\nBody.')).toEqual([
      { path: 'a.md', heading: '', line: 1, text: 'Preamble.' },
      { path: 'a.md', heading: 'Title', line: 2, text: 'Body.' },
    ])
  })

  it('resets deeper headings when a shallower heading starts', () => {
    const content = '# A\n## B\nb\n## C\nc'
    expect(splitArticleIntoSections('a.md', content).map((section) => section.heading)).toEqual(['A › B', 'A › C'])
  })

  it('ignores headings inside fenced code blocks', () => {
    const content = '# Runbook\n```bash\n# not a heading\necho ok\n```\nAfter.'
    expect(splitArticleIntoSections('a.md', content)).toEqual([
      { path: 'a.md', heading: 'Runbook', line: 1, text: '```bash\n# not a heading\necho ok\n```\nAfter.' },
    ])
  })

  it('drops sections without text', () => {
    expect(splitArticleIntoSections('a.md', '# Empty\n\n## Filled\ntext')).toEqual([
      { path: 'a.md', heading: 'Empty › Filled', line: 3, text: 'text' },
    ])
  })

  it('splits long sections at line boundaries keeping the heading', () => {
    const line = 'word '.repeat(40).trim()
    const lines = Array.from({ length: 6 }, () => line)
    const sections = splitArticleIntoSections('a.md', `# Long\n${lines.join('\n')}`)

    expect(sections.length).toBeGreaterThan(1)
    expect(sections.every((section) => section.heading === 'Long' && section.line === 1)).toBe(true)
    expect(sections.every((section) => section.text.length <= 500)).toBe(true)
    expect(sections.map((section) => section.text).join('\n')).toBe(lines.join('\n'))
  })

  it('keeps a single line longer than the limit whole', () => {
    const line = 'x'.repeat(700)
    expect(splitArticleIntoSections('a.md', `# Long\n${line}`)).toEqual([{ path: 'a.md', heading: 'Long', line: 1, text: line }])
  })
})

describe('tokenize', () => {
  it.each([
    ['Índice de Proyectos', ['indice', 'proyectos']],
    ['¿Dónde se aloja la web?', ['aloja', 'web']],
    ['Where is the site hosted', ['site', 'hosted']],
    ['kb-http-backend.ts', ['kb', 'http', 'backend', 'ts']],
    ['a 1 ok', ['ok']],
    ['Beds24 → WordPress', ['beds24', 'wordpress']],
  ])('tokenizes %s', (text, expected) => {
    expect(tokenize(text)).toEqual(expected)
  })
})
