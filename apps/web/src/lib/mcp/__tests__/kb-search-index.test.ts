import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeEmbedding } from '@/lib/mcp/__tests__/kb-search-fake-embeddings'

const embeddings = vi.hoisted(() => ({
  embedPassages: vi.fn(),
  embedQuery: vi.fn(),
}))

vi.mock('@/lib/mcp/kb-search-embeddings', () => embeddings)

const vectorCache = vi.hoisted(() => ({
  readVectorCache: vi.fn(),
  writeVectorCache: vi.fn(),
}))

vi.mock('@/lib/mcp/kb-search-vector-cache', () => vectorCache)

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
    vectorCache.readVectorCache.mockResolvedValue(new Map())
    vectorCache.writeVectorCache.mockResolvedValue(undefined)
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
    const failing = vi.fn(async () => ({ ok: false as const, error: 'read_failed' }))

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

  it('does not match sibling folders that share the prefix', async () => {
    const articles = [
      { path: 'Proyectos/Arche/a.md', content: '# A\nvercel hosting' },
      { path: 'Proyectos/Archelab/b.md', content: '# B\nvercel hosting' },
    ]
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    const result = await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(articles), pathPrefix: 'Proyectos/Arche', query: 'vercel', limit: 10 })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/Arche/a.md'])
  })

  it('keeps the newer index when an older build finishes last', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    let releaseOld: () => void = () => {}
    const oldLoader = vi.fn(() => new Promise<{ ok: true; articles: Article[] }>((resolve) => {
      releaseOld = () => resolve({ ok: true, articles: ARTICLES })
    }))
    const newLoader = loaderOf([...ARTICLES, { path: 'new.md', content: '# Kubernetes\nCluster notes.' }])

    const oldSearch = searchKbIndex({ headHash: 'h1', loadArticles: oldLoader, query: 'vercel', limit: 10 })
    await searchKbIndex({ headHash: 'h2', loadArticles: newLoader, query: 'kubernetes', limit: 10 })
    releaseOld()
    await oldSearch

    const result = await searchKbIndex({ headHash: 'h2', loadArticles: newLoader, query: 'kubernetes', limit: 10 })
    expect(newLoader).toHaveBeenCalledTimes(1)
    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['new.md'])
  })

  it('logs why loading the articles failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')

    await searchKbIndex({ headHash: 'h1', loadArticles: async () => ({ ok: false, error: 'read_failed' }), query: 'vercel', limit: 10 })

    expect(errorSpy).toHaveBeenCalledWith('[kb-search] Loading articles failed', 'read_failed')
    errorSpy.mockRestore()
  })

  it('reuses cached vectors on the first build and embeds only the rest', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })
    const [saved] = vectorCache.writeVectorCache.mock.calls[0]

    vi.resetModules()
    embeddings.embedPassages.mockClear()
    vectorCache.readVectorCache.mockResolvedValue(new Map([...saved].slice(0, 1)))
    const { searchKbIndex: searchAfterRestart } = await import('@/lib/mcp/kb-search-index')
    const result = await searchAfterRestart({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })

    expect(embeddings.embedPassages).toHaveBeenCalledTimes(1)
    expect(embeddings.embedPassages).toHaveBeenCalledWith(['Arche › Deploy\nAnsible deploy on a VPS.'])
    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/Magua/00 - Magua.md'])
  })

  it('saves the vectors of the current sections after embedding new ones', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })

    const changed = [ARTICLES[0], { path: ARTICLES[1].path, content: '# Arche\n## Deploy\nAnsible deploy over Tailscale.' }]
    await searchKbIndex({ headHash: 'h2', loadArticles: loaderOf(changed), query: 'vercel', limit: 10 })

    expect(vectorCache.readVectorCache).toHaveBeenCalledTimes(1)
    expect(vectorCache.writeVectorCache).toHaveBeenCalledTimes(2)
    const [saved] = vectorCache.writeVectorCache.mock.calls[1]
    expect([...saved.values()]).toEqual([
      fakeEmbedding('Magua › Stack\nHosting: Vercel with security headers.'),
      fakeEmbedding('Arche › Deploy\nAnsible deploy over Tailscale.'),
    ])
  })

  it('does not rewrite the cache when every section was already embedded', async () => {
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')
    await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })
    await searchKbIndex({ headHash: 'h2', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })

    expect(vectorCache.writeVectorCache).toHaveBeenCalledTimes(1)
  })

  it('still answers and logs when saving the vectors fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vectorCache.writeVectorCache.mockRejectedValueOnce(new Error('EACCES'))
    const { searchKbIndex } = await import('@/lib/mcp/kb-search-index')

    const result = await searchKbIndex({ headHash: 'h1', loadArticles: loaderOf(ARTICLES), query: 'vercel', limit: 10 })

    expect(result.ok).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('[kb-search] Saving vectors failed', expect.any(Error))
    errorSpy.mockRestore()
  })
})
