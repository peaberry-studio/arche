import * as path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveRepoRoot,
  mockHasBareRepoLayout,
  mockIsGitAvailable,
  mockCloneRepoToTemp,
  mockCleanupClone,
  mockHashContent,
  mockRunGit,
  mockRunGitOnBareRepo,
  mockDetectDefaultBranch,
  mockGetKbConfigRoot,
  mockGetKbContentRoot,
  mockReadFile,
  mockWriteFile,
  mockMkdir,
  mockMutateBareRepo,
} = vi.hoisted(() => ({
  mockResolveRepoRoot: vi.fn(),
  mockHasBareRepoLayout: vi.fn(),
  mockIsGitAvailable: vi.fn(),
  mockCloneRepoToTemp: vi.fn(),
  mockCleanupClone: vi.fn(),
  mockHashContent: vi.fn(),
  mockRunGit: vi.fn(),
  mockRunGitOnBareRepo: vi.fn(),
  mockDetectDefaultBranch: vi.fn(),
  mockGetKbConfigRoot: vi.fn(),
  mockGetKbContentRoot: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockMutateBareRepo: vi.fn(),
}))

vi.mock('@/lib/git/bare-repo', () => ({
  resolveRepoRoot: mockResolveRepoRoot,
  hasBareRepoLayout: mockHasBareRepoLayout,
  isGitAvailable: mockIsGitAvailable,
  cloneRepoToTemp: mockCloneRepoToTemp,
  cleanupClone: mockCleanupClone,
  hashContent: mockHashContent,
  runGit: mockRunGit,
  runGitOnBareRepo: mockRunGitOnBareRepo,
  detectDefaultBranch: mockDetectDefaultBranch,
  mutateBareRepo: mockMutateBareRepo,
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbConfigRoot: mockGetKbConfigRoot,
  getKbContentRoot: mockGetKbContentRoot,
}))

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path')
  return { ...actual, default: actual }
})

import {
  getCommonWorkspaceConfigHash,
  listRecentKbFileUpdates,
  readCommonWorkspaceConfig,
  readConfigRepoFile,
  writeCommonWorkspaceConfig,
} from '@/lib/common-workspace-config-store'

const CLONE_DIR = '/tmp/arche-kb-abc'
const SAFE_CONFIG_DIR = '/tmp/arche-safe'
const CONFIG_ROOT = '/data/kb/config'
const CONTENT_ROOT = '/data/kb/content'
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/tmp/safe/gitconfig' }

function setupAvailableRepo() {
  mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
  mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
  mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
  mockHasBareRepoLayout.mockResolvedValue(true)
  mockIsGitAvailable.mockResolvedValue(true)
  mockCloneRepoToTemp.mockResolvedValue({
    ok: true,
    dir: CLONE_DIR,
    gitEnv: GIT_ENV,
    safeConfigDir: SAFE_CONFIG_DIR,
  })
  mockCleanupClone.mockResolvedValue(undefined)
  mockHashContent.mockReturnValue('sha256hash')
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
}

describe('readCommonWorkspaceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns config content, hash, and path on success', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('{"key":"value"}')

    const result = await readCommonWorkspaceConfig()

    expect(result).toEqual({
      ok: true,
      content: '{"key":"value"}',
      hash: 'sha256hash',
      path: `${CONFIG_ROOT}#CommonWorkspaceConfig.json`,
    })
    expect(mockReadFile).toHaveBeenCalledWith(
      path.join(CLONE_DIR, 'CommonWorkspaceConfig.json'),
      'utf-8'
    )
    expect(mockHashContent).toHaveBeenCalledWith('{"key":"value"}')
  })

  it('returns kb_unavailable when repo root is null', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(null)

    const result = await readCommonWorkspaceConfig()
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns kb_unavailable when repo is not a bare layout', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(false)

    const result = await readCommonWorkspaceConfig()
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns read_failed when git is not available', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(false)

    const result = await readCommonWorkspaceConfig()
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns read_failed when clone fails', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({ ok: false })

    const result = await readCommonWorkspaceConfig()
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns not_found when config file does not exist (ENOENT)', async () => {
    setupAvailableRepo()
    const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(error)

    const result = await readCommonWorkspaceConfig()
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('returns read_failed for non-ENOENT fs errors', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('permission denied'))

    const result = await readCommonWorkspaceConfig()
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('always calls cleanupClone after successful clone', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('{}')

    await readCommonWorkspaceConfig()
    expect(mockCleanupClone).toHaveBeenCalledWith({
      ok: true,
      dir: CLONE_DIR,
      gitEnv: GIT_ENV,
      safeConfigDir: SAFE_CONFIG_DIR,
    })
  })

  it('calls cleanupClone even when readFile throws', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('unexpected'))

    await readCommonWorkspaceConfig()
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('calls cleanupClone even when readFile throws ENOENT', async () => {
    setupAvailableRepo()
    const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(error)

    await readCommonWorkspaceConfig()
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('does not call cleanupClone when clone itself fails', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({ ok: false })

    await readCommonWorkspaceConfig()
    expect(mockCleanupClone).not.toHaveBeenCalled()
  })
})

describe('writeCommonWorkspaceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns kb_unavailable when repo root is null', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(null)

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
    expect(mockMutateBareRepo).not.toHaveBeenCalled()
  })

  it('returns conflict when expectedHash does not match current content hash', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockReadFile.mockResolvedValue('{"existing":"data"}')
    mockHashContent.mockReturnValue('current-hash')
    mockMutateBareRepo.mockImplementation(async (args) => {
      const mutation = await args.mutate({ currentHash: 'commit', gitEnv: GIT_ENV, repoDir: CLONE_DIR })
      return mutation.ok ? { ok: true, data: mutation.data, hash: 'commit' } : mutation
    })

    const result = await writeCommonWorkspaceConfig('{"new":"data"}', 'stale-hash')
    expect(result).toEqual({ ok: false, error: 'conflict' })
  })

  it('writes config through mutateBareRepo with canonical author and changed path', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockReadFile.mockResolvedValue('{"key":"value"}')
    mockHashContent.mockReturnValue('matching-hash')
    mockMutateBareRepo.mockImplementation(async (args) => {
      const mutation = await args.mutate({ currentHash: 'commit', gitEnv: GIT_ENV, repoDir: CLONE_DIR })
      return mutation.ok ? { ok: true, data: mutation.data, hash: 'next-commit' } : mutation
    })

    const result = await writeCommonWorkspaceConfig('{"key":"value"}', 'matching-hash')
    expect(result).toEqual({ ok: true, hash: 'matching-hash' })

    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(CLONE_DIR, 'CommonWorkspaceConfig.json'),
      '{"key":"value"}',
      'utf-8'
    )
    expect(mockMutateBareRepo).toHaveBeenCalledWith(expect.objectContaining({
      commitMessage: 'Update common workspace config',
      gitAuthorEmail: 'config@arche.local',
      gitAuthorName: 'Arche Config',
      root: CONFIG_ROOT,
    }))
    const delegateArgs = mockMutateBareRepo.mock.calls[0][0]
    const mutation = await delegateArgs.mutate({ currentHash: 'commit', gitEnv: GIT_ENV, repoDir: CLONE_DIR })
    expect(mutation).toEqual({ ok: true, changedPaths: ['CommonWorkspaceConfig.json'], data: { hash: 'matching-hash' } })
  })

  it('skips hash check when expectedHash is not provided', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockReadFile.mockResolvedValue('{"old":"content"}')
    mockHashContent.mockReturnValue('some-hash')
    mockMutateBareRepo.mockImplementation(async (args) => {
      const mutation = await args.mutate({ currentHash: 'commit', gitEnv: GIT_ENV, repoDir: CLONE_DIR })
      return mutation.ok ? { ok: true, data: mutation.data, hash: 'commit' } : mutation
    })

    const result = await writeCommonWorkspaceConfig('{"old":"content"}')
    expect(result).toEqual({ ok: true, hash: 'some-hash' })
  })

  it('skips hash check when current file is empty (read fails)', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockHashContent.mockReturnValue('hash-of-new')
    mockMutateBareRepo.mockImplementation(async (args) => {
      const mutation = await args.mutate({ currentHash: 'commit', gitEnv: GIT_ENV, repoDir: CLONE_DIR })
      return mutation.ok ? { ok: true, data: mutation.data, hash: 'commit' } : mutation
    })

    const result = await writeCommonWorkspaceConfig('{"new":"data"}', 'any-hash')
    expect(result).toEqual({ ok: true, hash: 'hash-of-new' })
  })

  it('preserves mutateBareRepo conflicts including fetch-first push rejections', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockMutateBareRepo.mockResolvedValue({ ok: false, error: 'conflict' })

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'conflict' })
  })

  it('maps mutateBareRepo repo availability failures to kb_unavailable', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockMutateBareRepo.mockResolvedValue({ ok: false, error: 'repo_unavailable' })

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it.each(['clone_failed', 'git_unavailable', 'write_failed'] as const)(
    'maps mutateBareRepo %s to write_failed',
    async (error) => {
      mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
      mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
      mockMutateBareRepo.mockResolvedValue({ ok: false, error })

      const result = await writeCommonWorkspaceConfig('{}')
      expect(result).toEqual({ ok: false, error: 'write_failed' })
    }
  )

  it('creates parent directory before writing file', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockHashContent.mockReturnValue('h')
    mockMutateBareRepo.mockImplementation(async (args) => {
      const mutation = await args.mutate({ currentHash: 'commit', gitEnv: GIT_ENV, repoDir: CLONE_DIR })
      return mutation.ok ? { ok: true, data: mutation.data, hash: 'commit' } : mutation
    })

    await writeCommonWorkspaceConfig('content')

    expect(mockMkdir).toHaveBeenCalledWith(
      path.dirname(path.join(CLONE_DIR, 'CommonWorkspaceConfig.json')),
      { recursive: true }
    )
  })
})

describe('listRecentKbFileUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses git log output with __COMMIT__ markers', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: [
        '__COMMIT__Alice|2024-01-15T10:00:00+00:00',
        'docs/article-1.md',
        'docs/article-2.md',
        '',
        '__COMMIT__Bob|2024-01-14T09:00:00+00:00',
        'docs/article-3.md',
        '',
      ].join('\n'),
    })

    const result = await listRecentKbFileUpdates()

    expect(result).toEqual({
      ok: true,
      updates: [
        {
          filePath: 'docs/article-1.md',
          fileName: 'article-1.md',
          author: 'Alice',
          committedAt: '2024-01-15T10:00:00+00:00',
        },
        {
          filePath: 'docs/article-2.md',
          fileName: 'article-2.md',
          author: 'Alice',
          committedAt: '2024-01-15T10:00:00+00:00',
        },
        {
          filePath: 'docs/article-3.md',
          fileName: 'article-3.md',
          author: 'Bob',
          committedAt: '2024-01-14T09:00:00+00:00',
        },
      ],
    })
  })

  it('deduplicates file paths across commits', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: [
        '__COMMIT__Alice|2024-01-15T10:00:00+00:00',
        'docs/file.md',
        '',
        '__COMMIT__Bob|2024-01-14T09:00:00+00:00',
        'docs/file.md', // same file, different commit
        'docs/other.md',
        '',
      ].join('\n'),
    })

    const result = await listRecentKbFileUpdates()

    expect(result).toEqual({
      ok: true,
      updates: [
        {
          filePath: 'docs/file.md',
          fileName: 'file.md',
          author: 'Alice',
          committedAt: '2024-01-15T10:00:00+00:00',
        },
        {
          filePath: 'docs/other.md',
          fileName: 'other.md',
          author: 'Bob',
          committedAt: '2024-01-14T09:00:00+00:00',
        },
      ],
    })
  })

  it('respects the limit parameter', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: [
        '__COMMIT__Alice|2024-01-15T10:00:00+00:00',
        'file1.md',
        'file2.md',
        'file3.md',
        'file4.md',
        'file5.md',
      ].join('\n'),
    })

    const result = await listRecentKbFileUpdates(2)

    expect(result).toEqual({
      ok: true,
      updates: [
        { filePath: 'file1.md', fileName: 'file1.md', author: 'Alice', committedAt: '2024-01-15T10:00:00+00:00' },
        { filePath: 'file2.md', fileName: 'file2.md', author: 'Alice', committedAt: '2024-01-15T10:00:00+00:00' },
      ],
    })
  })

  it('uses default limit of 10', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    const files = Array.from({ length: 15 }, (_, i) => `file${i + 1}.md`)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: ['__COMMIT__Author|2024-01-01T00:00:00+00:00', ...files].join('\n'),
    })

    const result = await listRecentKbFileUpdates()

    expect(result).toEqual({
      ok: true,
      updates: expect.any(Array),
    })
    if (result.ok) {
      expect(result.updates).toHaveLength(10)
    }
  })

  it('returns kb_unavailable when content repo root is null', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(null)

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns read_failed when git log fails', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({ ok: false, stderr: 'git log error' })

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns empty updates when log output is empty', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({ ok: true, stdout: '' })

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: true, updates: [] })
  })

  it('handles commit with no files', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: '__COMMIT__Alice|2024-01-15T10:00:00+00:00\n\n',
    })

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: true, updates: [] })
  })

  it('handles missing author gracefully (defaults to Unknown)', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: [
        '__COMMIT__|2024-01-15T10:00:00+00:00',
        'file.md',
      ].join('\n'),
    })

    const result = await listRecentKbFileUpdates()
    if (result.ok) {
      expect(result.updates[0].author).toBe('Unknown')
    }
  })

  it('handles missing date gracefully', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: [
        '__COMMIT__Alice|',
        'file.md',
      ].join('\n'),
    })

    const result = await listRecentKbFileUpdates()
    if (result.ok) {
      expect(result.updates[0].committedAt).toBe('')
    }
  })

  it('passes correct git log arguments', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({ ok: true, stdout: '' })

    await listRecentKbFileUpdates()

    expect(mockRunGitOnBareRepo).toHaveBeenCalledWith(CONTENT_ROOT, [
      'log',
      '--name-only',
      '--date=iso-strict',
      '--pretty=format:__COMMIT__%an|%ad',
    ])
  })

  it('skips blank lines between files', async () => {
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: [
        '__COMMIT__Alice|2024-01-15T10:00:00+00:00',
        '',
        '  ',
        'file.md',
        '',
      ].join('\n'),
    })

    const result = await listRecentKbFileUpdates()
    if (result.ok) {
      expect(result.updates).toHaveLength(1)
      expect(result.updates[0].filePath).toBe('file.md')
    }
  })
})

describe('readConfigRepoFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns file content on success', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('file content here')

    const result = await readConfigRepoFile('settings.json')

    expect(result).toEqual({ ok: true, content: 'file content here' })
    expect(mockReadFile).toHaveBeenCalledWith(
      path.join(CLONE_DIR, 'settings.json'),
      'utf-8'
    )
  })

  it('returns { ok: false } when repo root is null', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(null)

    const result = await readConfigRepoFile('test.json')
    expect(result).toEqual({ ok: false })
  })

  it('returns { ok: false } when not a bare repo', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(false)

    const result = await readConfigRepoFile('test.json')
    expect(result).toEqual({ ok: false })
  })

  it('returns { ok: false } when git is not available', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(false)

    const result = await readConfigRepoFile('test.json')
    expect(result).toEqual({ ok: false })
  })

  it('returns { ok: false } when clone fails', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({ ok: false })

    const result = await readConfigRepoFile('test.json')
    expect(result).toEqual({ ok: false })
  })

  it('returns { ok: false } when readFile throws', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('read error'))

    const result = await readConfigRepoFile('missing.json')
    expect(result).toEqual({ ok: false })
  })

  it('always calls cleanupClone after successful clone', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('data')

    await readConfigRepoFile('file.json')
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('calls cleanupClone even when readFile throws', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('fail'))

    await readConfigRepoFile('file.json')
    expect(mockCleanupClone).toHaveBeenCalled()
  })
})

describe('getCommonWorkspaceConfigHash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns hash when readCommonWorkspaceConfig succeeds', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('content')
    mockHashContent.mockReturnValue('the-hash')

    const result = await getCommonWorkspaceConfigHash()
    expect(result).toEqual({ ok: true, hash: 'the-hash' })
  })

  it('passes through kb_unavailable error', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(null)

    const result = await getCommonWorkspaceConfigHash()
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('passes through not_found error', async () => {
    setupAvailableRepo()
    const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(error)

    const result = await getCommonWorkspaceConfigHash()
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('passes through read_failed error', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(false)

    const result = await getCommonWorkspaceConfigHash()
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })
})
