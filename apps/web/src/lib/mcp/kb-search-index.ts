import { embedPassages, embedQuery } from '@/lib/mcp/kb-search-embeddings'
import {
  aggregateByArticle,
  buildLexicalIndex,
  fuseRankings,
  rankLexical,
  rankSemantic,
  type KbSearchMatch,
  type LexicalIndex,
} from '@/lib/mcp/kb-search-ranking'
import { splitArticleIntoSections, type KbSection } from '@/lib/mcp/kb-search-sections'

export type KbArticleContent = { path: string; content: string }

type LoadArticles = () => Promise<{ ok: true; articles: KbArticleContent[] } | { ok: false }>

type SearchIndex = {
  headHash: string
  sections: KbSection[]
  lexical: LexicalIndex
  vectors: Float32Array[]
  vectorsByText: Map<string, Float32Array>
}

const MIN_SEMANTIC_SIMILARITY = 0.3
const SEMANTIC_CANDIDATES = 50

let currentIndex: SearchIndex | null = null
let pendingBuild: { headHash: string; promise: Promise<SearchIndex | null> } | null = null

export async function searchKbIndex(input: {
  headHash: string | null
  loadArticles: LoadArticles
  query: string
  pathPrefix?: string
  limit: number
}): Promise<{ ok: true; matches: KbSearchMatch[] } | { ok: false; error: 'search_failed' }> {
  if (input.headHash === null) return { ok: true, matches: [] }

  const index = await getIndex(input.headHash, input.loadArticles)
  if (!index) return { ok: false, error: 'search_failed' }

  const queryVector = await embedQuery(input.query).catch((error: unknown) => {
    console.error('[kb-search] Query embedding failed', error)
    return null
  })
  if (!queryVector) return { ok: false, error: 'search_failed' }

  const allowed = (position: number) =>
    !input.pathPrefix || index.sections[position].path.startsWith(`${input.pathPrefix}/`)
  const lexicalRanking = rankLexical(index.lexical, input.query).filter(allowed)
  const semanticRanking = rankSemantic(index.vectors, queryVector, MIN_SEMANTIC_SIMILARITY)
    .filter(allowed)
    .slice(0, SEMANTIC_CANDIDATES)

  const scores = fuseRankings([lexicalRanking, semanticRanking])
  return { ok: true, matches: aggregateByArticle(index.sections, scores, input.limit) }
}

function getIndex(headHash: string, loadArticles: LoadArticles): Promise<SearchIndex | null> {
  if (currentIndex?.headHash === headHash) return Promise.resolve(currentIndex)
  if (pendingBuild?.headHash === headHash) return pendingBuild.promise

  const promise = buildIndex(headHash, loadArticles, currentIndex?.vectorsByText ?? new Map()).catch((error: unknown) => {
    console.error('[kb-search] Index build failed', error)
    return null
  }).then((index) => {
    if (index) currentIndex = index
    return index
  }).finally(() => {
    if (pendingBuild?.promise === promise) pendingBuild = null
  })
  pendingBuild = { headHash, promise }
  return promise
}

async function buildIndex(
  headHash: string,
  loadArticles: LoadArticles,
  previousVectors: Map<string, Float32Array>,
): Promise<SearchIndex | null> {
  const loaded = await loadArticles()
  if (!loaded.ok) return null

  const sections = loaded.articles.flatMap((article) => splitArticleIntoSections(article.path, article.content))
  const passages = sections.map((section) => `${section.heading || section.path}\n${section.text}`)

  const vectorsByText = new Map<string, Float32Array>()
  const missing: string[] = []
  for (const passage of new Set(passages)) {
    const previous = previousVectors.get(passage)
    if (previous) vectorsByText.set(passage, previous)
    else missing.push(passage)
  }
  const embedded = await embedPassages(missing)
  missing.forEach((passage, position) => vectorsByText.set(passage, embedded[position]))

  const vectors: Float32Array[] = []
  for (const passage of passages) {
    const vector = vectorsByText.get(passage)
    if (!vector) return null
    vectors.push(vector)
  }

  return { headHash, sections, lexical: buildLexicalIndex(sections), vectors, vectorsByText }
}
