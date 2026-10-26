import { describe, expect, it } from 'vitest'

import { aggregateByArticle, buildLexicalIndex, fuseRankings, rankLexical, rankSemantic } from '@/lib/mcp/kb-search-ranking'
import type { KbSection } from '@/lib/mcp/kb-search-sections'

function section(path: string, heading: string, text: string, line = 1): KbSection {
  return { path, heading, line, text }
}

const SECTIONS: KbSection[] = [
  section('Proyectos/Magua/00 - Magua.md', 'Magua › Stack', 'Hosting: Vercel with security headers.'),
  section('Proyectos/Magua/decisions/hosting.md', 'Hosting on a subdomain', 'Serve from a subdomain of josemi.me.'),
  section('Proyectos/Arche/00 - Arche.md', 'Arche › Tech Stack', 'Next.js, Postgres and Podman.'),
  section('Proyectos/Arche/00 - Arche.md', 'Arche › Deploy', 'Ansible deploy with Vercel-free hosting on a VPS.', 12),
]

describe('rankLexical', () => {
  it('matches query terms that are not contiguous in the text', () => {
    const ranking = rankLexical(buildLexicalIndex(SECTIONS), 'vercel headers')
    expect(ranking[0]).toBe(0)
  })

  it('counts terms in the path and heading', () => {
    const ranking = rankLexical(buildLexicalIndex(SECTIONS), 'subdomain decisions')
    expect(ranking[0]).toBe(1)
  })

  it('ignores case and accents', () => {
    const ranking = rankLexical(buildLexicalIndex([section('a.md', 'Índice', 'Proyectos')]), 'INDICE proyectos')
    expect(ranking).toEqual([0])
  })

  it('returns only sections that share a term with the query', () => {
    expect(rankLexical(buildLexicalIndex(SECTIONS), 'kubernetes')).toEqual([])
  })

  it('ranks rarer terms higher than common ones', () => {
    const ranking = rankLexical(buildLexicalIndex(SECTIONS), 'hosting podman')
    expect(ranking[0]).toBe(2)
  })
})

describe('rankSemantic', () => {
  const vectors = [
    Float32Array.from([1, 0]),
    Float32Array.from([0.6, 0.8]),
    Float32Array.from([0, 1]),
  ]

  it('orders sections by cosine similarity', () => {
    expect(rankSemantic(vectors, Float32Array.from([0.8, 0.6]), 0)).toEqual([1, 0, 2])
  })

  it('drops sections below the minimum similarity', () => {
    expect(rankSemantic(vectors, Float32Array.from([1, 0]), 0.5)).toEqual([0, 1])
  })
})

describe('fuseRankings', () => {
  it('scores by reciprocal rank and sums across rankings', () => {
    const scores = fuseRankings([[3, 1], [1, 2]])
    expect(scores.get(1)).toBeCloseTo(1 / 62 + 1 / 61)
    expect(scores.get(3)).toBeCloseTo(1 / 61)
    expect(scores.get(2)).toBeCloseTo(1 / 62)
  })
})

describe('aggregateByArticle', () => {
  it('returns one match per article using its best section, ordered by score', () => {
    const scores = new Map([[2, 0.01], [3, 0.03], [0, 0.02]])

    expect(aggregateByArticle(SECTIONS, scores, 10)).toEqual([
      { path: 'Proyectos/Arche/00 - Arche.md', heading: 'Arche › Deploy', line: 12, text: 'Ansible deploy with Vercel-free hosting on a VPS.', score: 0.03 },
      { path: 'Proyectos/Magua/00 - Magua.md', heading: 'Magua › Stack', line: 1, text: 'Hosting: Vercel with security headers.', score: 0.02 },
    ])
  })

  it('applies the limit after aggregation', () => {
    const scores = new Map([[0, 0.3], [1, 0.2], [2, 0.1]])
    expect(aggregateByArticle(SECTIONS, scores, 2).map((match) => match.path)).toEqual([
      'Proyectos/Magua/00 - Magua.md',
      'Proyectos/Magua/decisions/hosting.md',
    ])
  })

  it('collapses whitespace and truncates snippets to 280 characters', () => {
    const long = section('a.md', 'A', `line one\n\n   line two ${'x'.repeat(400)}`)
    const [match] = aggregateByArticle([long], new Map([[0, 1]]), 10)

    expect(match.text.startsWith('line one line two x')).toBe(true)
    expect(match.text.length).toBe(280)
    expect(match.text.endsWith('…')).toBe(true)
  })
})
