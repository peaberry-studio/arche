import { tokenize, type KbSection } from '@/lib/mcp/kb-search-sections'

export type KbSearchMatch = {
  path: string
  heading: string
  line: number
  text: string
  score: number
}

export type LexicalIndex = {
  termCounts: Map<string, number>[]
  lengths: number[]
  averageLength: number
  documentFrequency: Map<string, number>
}

const BM25_K1 = 1.2
const BM25_B = 0.75
const RRF_K = 60
const SNIPPET_MAX_CHARS = 280

export function buildLexicalIndex(sections: KbSection[]): LexicalIndex {
  const documentFrequency = new Map<string, number>()
  const termCounts = sections.map((section) => {
    const counts = new Map<string, number>()
    for (const token of tokenize(`${section.path} ${section.heading} ${section.text}`)) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    return counts
  })

  const lengths = termCounts.map((counts) => [...counts.values()].reduce((sum, count) => sum + count, 0))
  const averageLength = lengths.reduce((sum, length) => sum + length, 0) / Math.max(lengths.length, 1)
  return { termCounts, lengths, averageLength, documentFrequency }
}

export function rankLexical(index: LexicalIndex, query: string): number[] {
  const terms = [...new Set(tokenize(query))]
  const total = index.termCounts.length
  const scored: Array<{ position: number; score: number }> = []

  index.termCounts.forEach((counts, position) => {
    let score = 0
    for (const term of terms) {
      const frequency = counts.get(term)
      if (!frequency) continue
      const documents = index.documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (total - documents + 0.5) / (documents + 0.5))
      const norm = BM25_K1 * (1 - BM25_B + BM25_B * (index.lengths[position] / index.averageLength))
      score += idf * ((frequency * (BM25_K1 + 1)) / (frequency + norm))
    }
    if (score > 0) scored.push({ position, score })
  })

  return scored.sort((left, right) => right.score - left.score).map((entry) => entry.position)
}

export function fuseRankings(rankings: number[][]): Map<number, number> {
  const scores = new Map<number, number>()
  for (const ranking of rankings) {
    ranking.forEach((position, rank) => {
      scores.set(position, (scores.get(position) ?? 0) + 1 / (RRF_K + rank + 1))
    })
  }
  return scores
}

export function aggregateByArticle(sections: KbSection[], scores: Map<number, number>, limit: number): KbSearchMatch[] {
  const best = new Map<string, { position: number; score: number }>()
  for (const [position, score] of scores) {
    const { path } = sections[position]
    const current = best.get(path)
    if (!current || score > current.score) best.set(path, { position, score })
  }

  return [...best.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ position, score }) => {
      const { path, heading, line, text } = sections[position]
      return { path, heading, line, text: toSnippet(text), score: Math.round(score * 10000) / 10000 }
    })
}

function toSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= SNIPPET_MAX_CHARS ? collapsed : `${collapsed.slice(0, SNIPPET_MAX_CHARS - 1)}…`
}
