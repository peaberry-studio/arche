import { aggregateByArticle, buildLexicalIndex, fuseRankings, rankLexical, type KbSearchMatch, type LexicalIndex } from '@/lib/mcp/kb-search-ranking'
import { splitArticleIntoSections, type KbSection } from '@/lib/mcp/kb-search-sections'

export type KbArticleContent = { path: string; content: string }

type LoadArticles = () => Promise<{ ok: true; articles: KbArticleContent[] } | { ok: false }>

type SearchIndex = {
  headHash: string
  sections: KbSection[]
  lexical: LexicalIndex
}

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

  const allowed = (position: number) =>
    !input.pathPrefix || index.sections[position].path.startsWith(`${input.pathPrefix}/`)
  const lexicalRanking = rankLexical(index.lexical, input.query).filter(allowed)

  return { ok: true, matches: aggregateByArticle(index.sections, fuseRankings([lexicalRanking]), input.limit) }
}

function getIndex(headHash: string, loadArticles: LoadArticles): Promise<SearchIndex | null> {
  if (currentIndex?.headHash === headHash) return Promise.resolve(currentIndex)
  if (pendingBuild?.headHash === headHash) return pendingBuild.promise

  const promise = buildIndex(headHash, loadArticles).then((index) => {
    if (index) currentIndex = index
    return index
  }).finally(() => {
    if (pendingBuild?.promise === promise) pendingBuild = null
  })
  pendingBuild = { headHash, promise }
  return promise
}

async function buildIndex(headHash: string, loadArticles: LoadArticles): Promise<SearchIndex | null> {
  const loaded = await loadArticles()
  if (!loaded.ok) return null

  const sections = loaded.articles.flatMap((article) => splitArticleIntoSections(article.path, article.content))
  return { headHash, sections, lexical: buildLexicalIndex(sections) }
}
