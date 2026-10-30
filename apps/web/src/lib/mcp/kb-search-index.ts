import { createHash } from 'node:crypto'

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
import { readVectorCache, writeVectorCache } from '@/lib/mcp/kb-search-vector-cache'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

export type KbArticleContent = { path: string; content: string }

type LoadArticles = () => Promise<{ ok: true; articles: KbArticleContent[] } | { ok: false; error: string }>

type SemanticIndex = {
  vectors: Float32Array[]
  vectorsByPassage: Map<string, Float32Array>
}

// `semantic` is null where the runtime ships no embedding model, so search ranks by terms only.
type SearchIndex = {
  headHash: string
  sections: KbSection[]
  lexical: LexicalIndex
  semantic: SemanticIndex | null
}

const MIN_SEMANTIC_SIMILARITY = 0.4
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
  if (index.sections.length === 0) return { ok: true, matches: [] }

  const allowed = (position: number) =>
    !input.pathPrefix || index.sections[position].path.startsWith(`${input.pathPrefix}/`)
  const rankings = [rankLexical(index.lexical, input.query).filter(allowed)]

  if (index.semantic) {
    const queryVector = await embedQuery(input.query).catch((error: unknown) => {
      console.error('[kb-search] Query embedding failed', error)
      return null
    })
    if (!queryVector) return { ok: false, error: 'search_failed' }

    rankings.push(rankSemantic(index.semantic.vectors, queryVector, MIN_SEMANTIC_SIMILARITY)
      .filter(allowed)
      .slice(0, SEMANTIC_CANDIDATES))
  }

  const scores = fuseRankings(rankings)
  return { ok: true, matches: aggregateByArticle(index.sections, scores, input.limit) }
}

function getIndex(headHash: string, loadArticles: LoadArticles): Promise<SearchIndex | null> {
  if (currentIndex?.headHash === headHash) return Promise.resolve(currentIndex)
  if (pendingBuild?.headHash === headHash) return pendingBuild.promise

  const promise = buildIndex(headHash, loadArticles, currentIndex?.semantic?.vectorsByPassage ?? null).catch((error: unknown) => {
    console.error('[kb-search] Index build failed', error)
    return null
  }).then((index) => {
    if (index && pendingBuild?.promise === promise) currentIndex = index
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
  previousVectors: Map<string, Float32Array> | null,
): Promise<SearchIndex | null> {
  const loaded = await loadArticles()
  if (!loaded.ok) {
    console.error('[kb-search] Loading articles failed', loaded.error)
    return null
  }

  const sections = loaded.articles.flatMap((article) => splitArticleIntoSections(article.path, article.content))
  const lexical = buildLexicalIndex(sections)
  if (!getRuntimeCapabilities().kbSemanticSearch) return { headHash, sections, lexical, semantic: null }

  const semantic = await buildSemanticIndex(sections, previousVectors)
  return semantic ? { headHash, sections, lexical, semantic } : null
}

async function buildSemanticIndex(
  sections: KbSection[],
  previousVectors: Map<string, Float32Array> | null,
): Promise<SemanticIndex | null> {
  const passages = sections.map((section) => `${section.heading || section.path}\n${section.text}`)
  const vectorsByPassage = await resolveVectors(passages, previousVectors ?? await readVectorCache())

  const vectors: Float32Array[] = []
  for (const passage of passages) {
    const vector = vectorsByPassage.get(passageKey(passage))
    if (!vector) return null
    vectors.push(vector)
  }

  return { vectors, vectorsByPassage }
}

// Reuses known vectors, embeds only new passages and persists the result when it changed.
async function resolveVectors(passages: string[], known: Map<string, Float32Array>): Promise<Map<string, Float32Array>> {
  const vectorsByPassage = new Map<string, Float32Array>()
  const missing = new Map<string, string>()
  for (const passage of passages) {
    const key = passageKey(passage)
    const vector = known.get(key)
    if (vector) vectorsByPassage.set(key, vector)
    else missing.set(key, passage)
  }
  if (missing.size === 0) return vectorsByPassage

  const missingKeys = [...missing.keys()]
  const embedded = await embedPassages([...missing.values()])
  missingKeys.forEach((key, position) => vectorsByPassage.set(key, embedded[position]))
  await writeVectorCache(vectorsByPassage).catch((error: unknown) => {
    console.error('[kb-search] Saving vectors failed', error)
  })
  return vectorsByPassage
}

function passageKey(passage: string): string {
  return createHash('sha256').update(passage).digest('hex')
}
