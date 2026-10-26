import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeEmbedding } from '@/lib/mcp/__tests__/kb-search-fake-embeddings'

const embeddings = vi.hoisted(() => ({
  embedPassages: vi.fn(),
  embedQuery: vi.fn(),
}))

vi.mock('@/lib/mcp/kb-search-embeddings', () => embeddings)

type Article = { path: string; content: string }

const ARTICLES: Article[] = [
  { path: 'Proyectos/Magua/00 - Magua.md', content: '# Magua\n## Stack\nHosting: Vercel with security headers.' },
  { path: 'Proyectos/Arche/00 - Arche.md', content: '# Arche\n## Deploy\nAnsible deploy on a VPS.' },
]

function loaderOf(articles: Article[]) {
  return vi.fn(async () => ({ ok: true as const, articles }))
}

describe('kb search index', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    embeddings.embedPassages.mockImplementation(async (texts: string[]) => texts.map(fakeEmbedding))
    embeddings.embedQuery.mockImplementation(async (text: string) => fakeEmbedding(text))
  })

  it('ranks articles from the loaded content', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const result = await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel hosting', limit: 10 })

    expect(result).toEqual({
      ok: true,
      matches: [expect.objectContaining({ path: 'Proyectos/Magua/00 - Magua.md', heading: 'Magua › Stack', line: 2 })],
    })
  })

  it('reuses the index while HEAD is unchanged', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const loadArticles = loaderOf(ARTICLES)

    await searchKbIndex({ headHash: 'h1', loadArticles, query: 'vercel', limit: 10 })
    await searchKbIndex({ headHash: 'h1', loadArticles, query: 'ansible', limit: 10 })

    expect(loadArticles).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when HEAD changes', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })

    const added = [...ARTICLES, { path: 'new.md', content: '# Kubernetes\nCluster notes.' }]
    const result = await searchKbIndex({ headHash: 'h2', loadArticles: loaderOf(added), query: 'kubernetes', limit: 10 })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['new.md'])
  })

  it('coalesces concurrent builds for the same HEAD', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const loadArticles = loaderOf(ARTICLES)

    await Promise.all([
      searchKbIndex({ headHash: 'h1', loadArticles, query: 'vercel', limit: 10 }),
      searchKbIndex({ headHash: 'h1', loadArticles, query: 'ansible', limit: 10 }),
    ])

    expect(loadArticles).toHaveBeenCalledTimes(1)
  })

  it('returns no matches for an empty repository without loading', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const loadArticles = loaderOf(ARTICLES)

    expect(await searchKbIndex({ headHash: null, loadArticles, query: 'vercel', limit: 10 })).toEqual({ ok: true, matches: [] })
    expect(loadArticles).not.toHaveBeenCalled()
  })

  it('restricts matches to the path prefix', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const result = await searchKbIndex({
      headHash: 'h1',
      loadArticles: loaderOf(ARTICLES),
      pathPrefix: 'Proyectos/Arche',
      query: 'deploy vercel',
      limit: 10,
    })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/Arche/00 - Arche.md'])
  })

  it('returns search_failed when loading fails and retries on the next search', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const failing = vi.fn(async () => ({ ok: false as const }))

    expect(await searchKbIndex({ headHash: 'h1', loadArticles: failing, query: 'vercel', limit: 10 })).toEqual({
      ok: false,
      error: 'search_failed',
    })

    const loadArticles = loaderOf(ARTICLES)
    const result = await searchKbIndex({ headHash: 'h1', loadArticles, query: 'vercel', limit: 10 })
    expect(result.ok).toBe(true)
    expect(loadArticles).toHaveBeenCalledTimes(1)
  })

  it('finds an article by meaning when the query shares no terms with it', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const result = await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'dónde se aloja', limit: 10 })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/Magua/00 - Magua.md'])
  })

  it('ranks an article matched by terms and meaning above one matched by meaning only', async () => {
    const articles = [
      { path: 'meaning.md', content: '# Notes\nAlojamiento del sitio.' },
      { path: 'both.md', content: '# Notes\nHosting on Vercel.' },
    ]
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const result = await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(articles), query: 'vercel hosting', limit: 10 })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['both.md', 'meaning.md'])
  })

  it('embeds only new or changed sections after a new commit', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })
    expect(embeddings.embedPassages).toHaveBeenLastCalledWith([
      'Magua › Stack\nHosting: Vercel with security headers.',
      'Arche › Deploy\nAnsible deploy on a VPS.',
    ])

    const changed = [ARTICLES[0], { path: ARTICLES[1].path, content: '# Arche\n## Deploy\nAnsible deploy over Tailscale.' }]
    await searchKbIndex({ headHash: 'h2', loadArticles: loaderOf(changed), query: 'vercel', limit: 10 })

    expect(embeddings.embedPassages).toHaveBeenLastCalledWith(['Arche › Deploy\nAnsible deploy over Tailscale.'])
  })

  it.each([
    ['passage embedding', () => embeddings.embedPassages.mockRejectedValueOnce(new Error('model unavailable'))],
    ['query embedding', () => embeddings.embedQuery.mockRejectedValueOnce(new Error('inference failed'))],
  ])('returns search_failed when %s fails and recovers on the next search', async (_, fail) => {
    fail()
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const loadArticles = loaderOf(ARTICLES)

    expect(await searchKbIndex({ headHash: 'h1', loadArticles, query: 'vercel', limit: 10 })).toEqual({
      ok: false,
      error: 'search_failed',
    })
    expect((await searchKbIndex({ headHash: 'h1', loadArticles, query: 'vercel', limit: 10 })).ok).toBe(true)
  })
})
