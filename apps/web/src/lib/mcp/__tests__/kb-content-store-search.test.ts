import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeEmbedding } from '@/lib/mcp/__tests__/kb-search-fake-embeddings'

const embeddings = vi.hoisted(() => ({
  embedPassages: vi.fn(),
  embedQuery: vi.fn(),
}))

vi.mock('@/lib/mcp/kb-search-embeddings', () => embeddings)

vi.mock('@/lib/mcp/kb-search-vector-cache', () => ({
  readVectorCache: vi.fn().mockResolvedValue(new Map()),
  writeVectorCache: vi.fn().mockResolvedValue(undefined),
}))

const mocks = vi.hoisted(() => ({
  cleanupClone: vi.fn(),
  cloneRepoToTemp: vi.fn(),
  hasBareRepoLayout: vi.fn(),
  runGit: vi.fn(),
  runGitOnBareRepo: vi.fn(),
}))

vi.mock('@/lib/git/bare-repo', () => ({
  cleanupClone: mocks.cleanupClone,
  cloneRepoToTemp: mocks.cloneRepoToTemp,
  detectDefaultBranch: vi.fn(),
  hasBareRepoLayout: mocks.hasBareRepoLayout,
  isGitAvailable: vi.fn().mockResolvedValue(true),
  mutateBareRepo: vi.fn(),
  resolveRepoRoot: vi.fn().mockResolvedValue('/kb-content.git'),
  runGit: mocks.runGit,
  runGitOnBareRepo: mocks.runGitOnBareRepo,
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: () => '/kb-content',
}))

const ARTICLES: Record<string, string> = {
  'Proyectos/Magua/00 - Magua.md': '# Magua\n## Stack\nHosting: Vercel with security headers.\n## Analytics\nGA4 consent mode.',
  'Proyectos/Arche/00 - Arche.md': '# Arche\n## Deploy\nAnsible deploy on a VPS behind Tailscale.',
  'notes.txt': 'vercel hosting',
}

let cloneDir: string

async function writeArticles(files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(cloneDir, file)), { recursive: true })
    await fs.writeFile(path.join(cloneDir, file), content)
  }
}

function headIs(hash: string) {
  mocks.runGitOnBareRepo.mockResolvedValue({ ok: true, stdout: `${hash}\n` })
}

describe('searchKb', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-search-'))
    await writeArticles(ARTICLES)
    mocks.hasBareRepoLayout.mockResolvedValue(true)
    mocks.cloneRepoToTemp.mockResolvedValue({ ok: true, dir: cloneDir, gitEnv: {}, safeConfigDir: '/tmp/safe' })
    headIs('abc123')
    mocks.runGit.mockResolvedValue({ ok: true, stdout: '' })
    embeddings.embedPassages.mockImplementation(async (texts: string[]) => texts.map(fakeEmbedding))
    embeddings.embedQuery.mockImplementation(async (text: string) => fakeEmbedding(text))
  })

  afterEach(async () => {
    await fs.rm(cloneDir, { recursive: true, force: true })
  })

  it('returns ranked article matches for non-contiguous query terms', async () => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'vercel headers hosting' })

    expect(result).toEqual({
      ok: true,
      matches: [{
        path: 'Proyectos/Magua/00 - Magua.md',
        heading: 'Magua › Stack',
        line: 2,
        text: 'Hosting: Vercel with security headers.',
        score: expect.any(Number),
      }],
    })
    expect(mocks.runGitOnBareRepo).toHaveBeenCalledWith('/kb-content.git', ['rev-parse', '--verify', '-q', 'HEAD'])
  })

  it('finds an article by meaning when the query shares no terms with it', async () => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'dónde se aloja la web' })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/Magua/00 - Magua.md'])
  })

  it('only searches markdown files', async () => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'vercel' })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/Magua/00 - Magua.md'])
  })

  it('restricts matches to the requested folder', async () => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'deploy vercel', path: 'Proyectos/Arche' })

    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/Arche/00 - Arche.md'])
  })

  it.each([
    [undefined, 10],
    [0, 1],
    [500, 50],
  ])('clamps limit %s to %s articles', async (limit, expected) => {
    await writeArticles(Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`bulk/${index}.md`, `# Note ${index}\nshared keyword`])
    ))

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'shared keyword', limit })

    expect(result.ok && result.matches).toHaveLength(expected)
  })

  it('reuses the index while HEAD is unchanged and rebuilds after a new commit', async () => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    await searchKb({ query: 'vercel' })
    await searchKb({ query: 'ansible' })
    expect(mocks.cloneRepoToTemp).toHaveBeenCalledTimes(1)

    await writeArticles({ 'Proyectos/New/00 - New.md': '# New\nKubernetes cluster.' })
    headIs('def456')
    const result = await searchKb({ query: 'kubernetes' })

    expect(mocks.cloneRepoToTemp).toHaveBeenCalledTimes(2)
    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['Proyectos/New/00 - New.md'])
  })

  it('reads the articles at the HEAD it resolved', async () => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    await searchKb({ query: 'vercel' })

    expect(mocks.runGit).toHaveBeenCalledWith(['checkout', '--quiet', '--detach', 'abc123'], { cwd: cloneDir, env: {} })
  })

  it('returns search_failed when the resolved HEAD cannot be checked out', async () => {
    mocks.runGit.mockResolvedValueOnce({ ok: false, stderr: 'fatal: reference is not a tree' })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    expect(await searchKb({ query: 'vercel' })).toEqual({ ok: false, error: 'search_failed' })
  })

  it('returns no matches for a repository without commits', async () => {
    mocks.runGitOnBareRepo.mockResolvedValue({ ok: false, stderr: '' })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')

    expect(await searchKb({ query: 'vercel' })).toEqual({ ok: true, matches: [] })
    expect(mocks.cloneRepoToTemp).not.toHaveBeenCalled()
  })

  it.each([
    ['empty query', { query: '   ' }, 'invalid_query'],
    ['query over 1000 characters', { query: 'a'.repeat(1001) }, 'invalid_query'],
    ['unsafe path', { query: 'vercel', path: '../etc' }, 'invalid_path'],
  ])('rejects %s', async (_, input, error) => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    expect(await searchKb(input)).toEqual({ ok: false, error })
  })

  it('returns kb_unavailable when the content repository is missing', async () => {
    mocks.hasBareRepoLayout.mockResolvedValue(false)

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    expect(await searchKb({ query: 'vercel' })).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns read_failed when HEAD cannot be resolved', async () => {
    mocks.runGitOnBareRepo.mockResolvedValue({ ok: false, stderr: 'fatal: not a git repository' })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    expect(await searchKb({ query: 'vercel' })).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns search_failed when the clone fails and retries on the next search', async () => {
    mocks.cloneRepoToTemp.mockResolvedValueOnce({ ok: false })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    expect(await searchKb({ query: 'vercel' })).toEqual({ ok: false, error: 'search_failed' })

    const retried = await searchKb({ query: 'vercel' })
    expect(retried.ok).toBe(true)
  })
})
