import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('@/lib/git/bare-repo', () => ({
  cleanupClone: vi.fn(),
  cloneRepoToTemp: vi.fn(),
  detectDefaultBranch: vi.fn(),
  hasBareRepoLayout: vi.fn(),
  isGitAvailable: vi.fn(),
  mutateBareRepo: vi.fn(),
  resolveRepoRoot: vi.fn(),
  runGit: vi.fn(),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbConfigRoot: vi.fn(() => '/data/kb/config'),
}))

import * as fs from 'node:fs/promises'
import {
  cleanupClone,
  cloneRepoToTemp,
  hasBareRepoLayout,
  isGitAvailable,
  mutateBareRepo,
  resolveRepoRoot,
  runGit,
} from '@/lib/git/bare-repo'
import {
  getConfigRepoHash,
  listConfigRepoFiles,
  mutateConfigRepo,
  readConfigRepoFileBuffer,
  readConfigRepoSnapshot,
} from '@/lib/config-repo-store'

const mockResolveRepoRoot = vi.mocked(resolveRepoRoot)
const mockHasBareRepoLayout = vi.mocked(hasBareRepoLayout)
const mockIsGitAvailable = vi.mocked(isGitAvailable)
const mockCloneRepoToTemp = vi.mocked(cloneRepoToTemp)
const mockCleanupClone = vi.mocked(cleanupClone)
const mockRunGit = vi.mocked(runGit)
const mockMutateBareRepo = vi.mocked(mutateBareRepo)
const mockReaddir = vi.mocked(fs.readdir)
const mockReadFile = vi.mocked(fs.readFile)
const mockStat = vi.mocked(fs.stat)

function setupAvailableRepo() {
  mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
  mockHasBareRepoLayout.mockResolvedValue(true)
  mockIsGitAvailable.mockResolvedValue(true)
  mockCloneRepoToTemp.mockResolvedValue({
    ok: true,
    dir: '/tmp/arche-kb-abc',
    gitEnv: { GIT_CONFIG_GLOBAL: '/tmp/safe/gitconfig' },
    safeConfigDir: '/tmp/safe',
  })
  mockCleanupClone.mockResolvedValue(undefined)
  mockRunGit.mockResolvedValue({ ok: true, stdout: 'abc123\n' })
}

describe('readConfigRepoSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns kb_unavailable when repo root is null', async () => {
    mockResolveRepoRoot.mockResolvedValue(null)
    const result = await readConfigRepoSnapshot(async () => 'data')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns kb_unavailable when not a bare repo layout', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockHasBareRepoLayout.mockResolvedValue(false)
    const result = await readConfigRepoSnapshot(async () => 'data')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns read_failed when git is not available', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(false)
    const result = await readConfigRepoSnapshot(async () => 'data')
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns read_failed when clone fails', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({ ok: false })
    const result = await readConfigRepoSnapshot(async () => 'data')
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns data with hash on success', async () => {
    setupAvailableRepo()
    const result = await readConfigRepoSnapshot(async ({ repoDir, hash }) => {
      return { repoDir, hash }
    })

    expect(result).toEqual({
      ok: true,
      data: { repoDir: '/tmp/arche-kb-abc', hash: 'abc123' },
      hash: 'abc123',
    })
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('returns null hash when rev-parse fails', async () => {
    setupAvailableRepo()
    mockRunGit.mockResolvedValue({ ok: false, stderr: 'error' })
    const result = await readConfigRepoSnapshot(async ({ hash }) => hash)

    expect(result).toEqual({ ok: true, data: null, hash: null })
  })

  it('returns null hash when rev-parse returns empty string', async () => {
    setupAvailableRepo()
    mockRunGit.mockResolvedValue({ ok: true, stdout: '  \n' })
    const result = await readConfigRepoSnapshot(async ({ hash }) => hash)

    expect(result).toEqual({ ok: true, data: null, hash: null })
  })

  it('always cleans up clone even on reader error', async () => {
    setupAvailableRepo()
    const result = readConfigRepoSnapshot(async () => {
      throw new Error('reader error')
    })

    await expect(result).rejects.toThrow('reader error')
    expect(mockCleanupClone).toHaveBeenCalled()
  })
})

describe('getConfigRepoHash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns hash on success', async () => {
    setupAvailableRepo()
    const result = await getConfigRepoHash()
    expect(result).toEqual({ ok: true, hash: 'abc123' })
  })

  it('returns kb_unavailable when root is null', async () => {
    mockResolveRepoRoot.mockResolvedValue(null)
    const result = await getConfigRepoHash()
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('always cleans up clone', async () => {
    setupAvailableRepo()
    await getConfigRepoHash()
    expect(mockCleanupClone).toHaveBeenCalled()
  })
})

describe('readConfigRepoFileBuffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns kb_unavailable when root is null', async () => {
    mockResolveRepoRoot.mockResolvedValue(null)
    const result = await readConfigRepoFileBuffer('test.md')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns kb_unavailable when not a bare repo', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockHasBareRepoLayout.mockResolvedValue(false)
    const result = await readConfigRepoFileBuffer('test.md')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns read_failed when git is unavailable', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(false)
    const result = await readConfigRepoFileBuffer('test.md')
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns read_failed when clone fails', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({ ok: false })
    const result = await readConfigRepoFileBuffer('test.md')
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('reads file content and returns with hash', async () => {
    setupAvailableRepo()
    const content = Buffer.from('hello world')
    mockReadFile.mockResolvedValue(content)

    const result = await readConfigRepoFileBuffer('docs/test.md')
    expect(result).toEqual({ ok: true, content, hash: 'abc123' })
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('normalizes path with leading slashes and backslashes', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue(Buffer.from('data'))

    await readConfigRepoFileBuffer('\\\\docs///test.md')
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('docs/test.md')
    )
  })

  it('returns not_found when file does not exist', async () => {
    setupAvailableRepo()
    const error = new Error('ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    mockReadFile.mockRejectedValue(error)

    const result = await readConfigRepoFileBuffer('missing.md')
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('returns read_failed for non-ENOENT errors', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('permission denied'))

    const result = await readConfigRepoFileBuffer('test.md')
    expect(result).toEqual({ ok: false, error: 'read_failed' })
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('throws on path traversal with ..', async () => {
    setupAvailableRepo()
    const result = await readConfigRepoFileBuffer('../../../etc/passwd')
    // normalizeRepoRelativePath throws for '..' segments, caught in the catch block
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })
})

describe('listConfigRepoFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns kb_unavailable when root is null', async () => {
    mockResolveRepoRoot.mockResolvedValue(null)
    const result = await listConfigRepoFiles('docs')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns empty files when directory does not exist', async () => {
    setupAvailableRepo()
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const result = await listConfigRepoFiles('missing-dir')
    expect(result).toEqual({ ok: true, files: [], hash: 'abc123' })
  })

  it('returns empty files when stat is not a directory', async () => {
    setupAvailableRepo()
    mockStat.mockResolvedValue({ isDirectory: () => false } as never)

    const result = await listConfigRepoFiles('file.md')
    expect(result).toEqual({ ok: true, files: [], hash: 'abc123' })
  })

  it('lists files recursively from a directory', async () => {
    setupAvailableRepo()
    mockStat.mockResolvedValue({ isDirectory: () => true } as never)

    mockReaddir.mockResolvedValueOnce([
      { name: 'article.md', isFile: () => true, isDirectory: () => false },
      { name: 'sub', isFile: () => false, isDirectory: () => true },
    ] as never)

    mockReadFile.mockResolvedValueOnce(Buffer.from('content'))

    // sub directory listing
    mockReaddir.mockResolvedValueOnce([
      { name: 'nested.md', isFile: () => true, isDirectory: () => false },
    ] as never)
    mockReadFile.mockResolvedValueOnce(Buffer.from('nested content'))

    const result = await listConfigRepoFiles('docs')
    expect(result).toEqual({
      ok: true,
      files: [
        { path: 'docs/article.md', content: Buffer.from('content') },
        { path: 'docs/sub/nested.md', content: Buffer.from('nested content') },
      ],
      hash: 'abc123',
    })
  })

  it('skips non-file non-directory entries (e.g. symlinks)', async () => {
    setupAvailableRepo()
    mockStat.mockResolvedValue({ isDirectory: () => true } as never)

    mockReaddir.mockResolvedValueOnce([
      { name: 'symlink', isFile: () => false, isDirectory: () => false },
    ] as never)

    const result = await listConfigRepoFiles('docs')
    expect(result).toEqual({ ok: true, files: [], hash: 'abc123' })
  })
})

describe('mutateConfigRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns kb_unavailable when root is null', async () => {
    mockResolveRepoRoot.mockResolvedValue(null)
    const result = await mutateConfigRepo({
      commitMessage: 'test',
      mutate: async () => [],
    })
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
    expect(mockMutateBareRepo).not.toHaveBeenCalled()
  })

  it('delegates config writes to mutateBareRepo with canonical author and root', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockMutateBareRepo.mockResolvedValue({ ok: true, data: undefined, hash: 'def456' })

    const result = await mutateConfigRepo({
      commitMessage: 'update file',
      expectedHash: 'abc123',
      mutate: async () => [],
    })

    expect(result).toEqual({ ok: true, hash: 'def456' })
    expect(mockMutateBareRepo).toHaveBeenCalledWith(expect.objectContaining({
      commitMessage: 'update file',
      expectedHash: 'abc123',
      gitAuthorEmail: 'config@arche.local',
      gitAuthorName: 'Arche Config',
      root: '/data/kb/config',
    }))
  })

  it('normalizes null mutateBareRepo hashes to the existing string hash contract', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockMutateBareRepo.mockResolvedValue({ ok: true, data: undefined, hash: null })

    const result = await mutateConfigRepo({
      commitMessage: 'test',
      mutate: async () => [],
    })

    expect(result).toEqual({ ok: true, hash: '' })
  })

  it('passes changed paths returned by mutate into mutateBareRepo', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockMutateBareRepo.mockImplementation(async (args) => {
      const mutation = await args.mutate({ currentHash: 'abc123', gitEnv: {}, repoDir: '/tmp/repo' })
      return mutation.ok ? { ok: true, data: mutation.data, hash: 'def456' } : mutation
    })

    const result = await mutateConfigRepo({
      commitMessage: 'test',
      mutate: async ({ repoDir }) => [`${repoDir}/../ignored`, '/file.md', '  file.md  '],
    })

    expect(result).toEqual({ ok: true, hash: 'def456' })
    const delegateArgs = mockMutateBareRepo.mock.calls[0][0]
    const mutation = await delegateArgs.mutate({ currentHash: 'abc123', gitEnv: {}, repoDir: '/tmp/repo' })
    expect(mutation).toEqual({ ok: true, changedPaths: ['/tmp/repo/../ignored', '/file.md', '  file.md  '], data: undefined })
  })

  it('preserves mutateBareRepo conflicts including fetch-first push rejections', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockMutateBareRepo.mockResolvedValue({ ok: false, error: 'conflict' })

    const result = await mutateConfigRepo({
      commitMessage: 'test',
      mutate: async () => ['file.md'],
    })
    expect(result).toEqual({ ok: false, error: 'conflict' })
  })

  it('maps mutateBareRepo repo availability failures to kb_unavailable', async () => {
    mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
    mockMutateBareRepo.mockResolvedValue({ ok: false, error: 'repo_unavailable' })

    const result = await mutateConfigRepo({
      commitMessage: 'test',
      mutate: async () => ['file.md'],
    })
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it.each(['clone_failed', 'git_unavailable', 'write_failed'] as const)(
    'maps mutateBareRepo %s to write_failed',
    async (error) => {
      mockResolveRepoRoot.mockResolvedValue('/data/kb/config')
      mockMutateBareRepo.mockResolvedValue({ ok: false, error })

      const result = await mutateConfigRepo({
        commitMessage: 'test',
        mutate: async () => ['file.md'],
      })

      expect(result).toEqual({ ok: false, error: 'write_failed' })
    }
  )
})
