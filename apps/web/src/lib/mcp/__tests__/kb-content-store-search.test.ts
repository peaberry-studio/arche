import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanupClone: vi.fn(),
  cloneRepoToTemp: vi.fn(),
  runGit: vi.fn(),
}))

vi.mock('@/lib/git/bare-repo', () => ({
  cleanupClone: mocks.cleanupClone,
  cloneRepoToTemp: mocks.cloneRepoToTemp,
  detectDefaultBranch: vi.fn(),
  hasBareRepoLayout: vi.fn().mockResolvedValue(true),
  isGitAvailable: vi.fn().mockResolvedValue(true),
  mutateBareRepo: vi.fn(),
  resolveRepoRoot: vi.fn().mockResolvedValue('/kb-content.git'),
  runGit: mocks.runGit,
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: () => '/kb-content',
}))

describe('searchKb', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.cloneRepoToTemp.mockResolvedValue({
      ok: true,
      dir: '/tmp/clone',
      gitEnv: { GIT_CONFIG_GLOBAL: '/tmp/safe/gitconfig' },
      safeConfigDir: '/tmp/safe',
    })
  })

  it('uses git grep and parses output into matches', async () => {
    mocks.runGit.mockResolvedValue({
      ok: true,
      stdout: 'alpha.md:1:first match\nnested/beta.md:1:another match\n',
    })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'match' })

    expect(result).toEqual({
      ok: true,
      matches: [
        { path: 'alpha.md', line: 1, text: 'first match' },
        { path: 'nested/beta.md', line: 1, text: 'another match' },
      ],
    })
    expect(mocks.cloneRepoToTemp).toHaveBeenCalledTimes(1)
    expect(mocks.runGit).toHaveBeenCalledWith(
      ['grep', '-n', '-i', '--fixed-strings', '--', 'match'],
      expect.objectContaining({ cwd: '/tmp/clone' })
    )
  })

  it('returns empty matches when git grep finds nothing', async () => {
    mocks.runGit.mockResolvedValue({ ok: false, stderr: '' })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'nonexistent' })

    expect(result).toEqual({ ok: true, matches: [] })
  })

  it('filters results to .md files only', async () => {
    mocks.runGit.mockResolvedValue({
      ok: true,
      stdout: 'readme.md:1:match\ndata.json:2:match\nnotes.md:3:match\n',
    })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'match' })

    expect(result).toEqual({
      ok: true,
      matches: [
        { path: 'readme.md', line: 1, text: 'match' },
        { path: 'notes.md', line: 3, text: 'match' },
      ],
    })
  })

  it('passes path filter as pathspec to git grep', async () => {
    mocks.runGit.mockResolvedValue({ ok: true, stdout: 'docs/guide.md:1:match\n' })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    await searchKb({ query: 'match', path: 'docs' })

    expect(mocks.runGit).toHaveBeenCalledWith(
      ['grep', '-n', '-i', '--fixed-strings', '--', 'match', 'docs/'],
      expect.objectContaining({ cwd: '/tmp/clone' })
    )
  })

  it('respects the limit parameter', async () => {
    mocks.runGit.mockResolvedValue({
      ok: true,
      stdout: 'a.md:1:one\nb.md:1:two\nc.md:1:three\n',
    })

    const { searchKb } = await import('@/lib/mcp/kb-content-store')
    const result = await searchKb({ query: 'o', limit: 2 })

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.matches).toHaveLength(2)
  })
})
