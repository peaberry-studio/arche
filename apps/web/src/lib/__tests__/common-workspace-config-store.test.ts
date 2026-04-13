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
  })

  it('returns kb_unavailable when not a bare repo', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(false)

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns write_failed when git is not available', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(false)

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'write_failed' })
  })

  it('returns write_failed when clone fails', async () => {
    mockGetKbConfigRoot.mockReturnValue(CONFIG_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONFIG_ROOT)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({ ok: false })

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'write_failed' })
  })

  it('writes content and pushes on success', async () => {
    setupAvailableRepo()
    mockDetectDefaultBranch.mockResolvedValue('master')
    mockRunGit.mockResolvedValue({ ok: true, stdout: '' })

    const result = await writeCommonWorkspaceConfig('{"new":"config"}')
    expect(result).toEqual({ ok: true })
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(CLONE_DIR, 'CommonWorkspaceConfig.json'),
      '{"new":"config"}',
      'utf-8'
    )
    expect(mockRunGit).toHaveBeenCalled()

    const pushCall = mockRunGit.mock.calls[3]
    expect(pushCall[0]).toEqual(['push', 'origin', 'HEAD:refs/heads/master'])
  })
})

describe('listRecentKbFileUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKbContentRoot.mockReturnValue(CONTENT_ROOT)
    mockResolveRepoRoot.mockResolvedValue(CONTENT_ROOT)
  })

  it('parses git log output with __COMMIT__ markers', async () => {
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
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: [
        '__COMMIT__Alice|2024-01-15T10:00:00+00:00',
        'docs/file.md',
        '',
        '__COMMIT__Bob|2024-01-14T09:00:00+00:00',
        'docs/file.md',
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

  it('pages through git history to collect unique files', async () => {
    mockRunGitOnBareRepo
      .mockResolvedValueOnce({
        ok: true,
        stdout: [
          '__COMMIT__Alice|2026-04-12T10:00:00Z',
          'notes/alpha.md',
          '',
          '__COMMIT__Bob|2026-04-12T09:00:00Z',
          'notes/alpha.md',
          '',
        ].join('\n'),
      })
      .mockResolvedValueOnce({
        ok: true,
        stdout: [
          '__COMMIT__Carol|2026-04-12T08:00:00Z',
          'notes/beta.md',
          '',
        ].join('\n'),
      })

    const result = await listRecentKbFileUpdates(2)

    expect(result).toEqual({
      ok: true,
      updates: [
        {
          filePath: 'notes/alpha.md',
          fileName: 'alpha.md',
          author: 'Alice',
          committedAt: '2026-04-12T10:00:00Z',
        },
        {
          filePath: 'notes/beta.md',
          fileName: 'beta.md',
          author: 'Carol',
          committedAt: '2026-04-12T08:00:00Z',
        },
      ],
    })

    expect(mockRunGitOnBareRepo).toHaveBeenCalledTimes(2)
    expect(mockRunGitOnBareRepo).toHaveBeenNthCalledWith(1, CONTENT_ROOT, [
      'log',
      '-n', '2',
      '--skip', '0',
      '--name-only',
      '--date=iso-strict',
      '--pretty=format:__COMMIT__%an|%ad',
    ])
    expect(mockRunGitOnBareRepo).toHaveBeenNthCalledWith(2, CONTENT_ROOT, [
      'log',
      '-n', '2',
      '--skip', '2',
      '--name-only',
      '--date=iso-strict',
      '--pretty=format:__COMMIT__%an|%ad',
    ])
  })

  it('returns no updates without querying git when the limit is zero', async () => {
    const result = await listRecentKbFileUpdates(0)

    expect(result).toEqual({ ok: true, updates: [] })
    expect(mockRunGitOnBareRepo).not.toHaveBeenCalled()
  })

  it('returns kb_unavailable when content repo root is null', async () => {
    mockResolveRepoRoot.mockResolvedValue(null)

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns read_failed when git log fails', async () => {
    mockRunGitOnBareRepo.mockResolvedValue({ ok: false, stderr: 'git log error' })

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })

  it('returns empty updates when log output is empty', async () => {
    mockRunGitOnBareRepo.mockResolvedValue({ ok: true, stdout: '' })

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: true, updates: [] })
  })

  it('handles commit with no files', async () => {
    mockRunGitOnBareRepo.mockResolvedValue({
      ok: true,
      stdout: '__COMMIT__Alice|2024-01-15T10:00:00+00:00\n\n',
    })

    const result = await listRecentKbFileUpdates()
    expect(result).toEqual({ ok: true, updates: [] })
  })

  it('handles missing author gracefully (defaults to Unknown)', async () => {
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

  it('passes correct git log arguments with paging', async () => {
    mockRunGitOnBareRepo.mockResolvedValue({ ok: true, stdout: '' })

    await listRecentKbFileUpdates()

    expect(mockRunGitOnBareRepo).toHaveBeenCalledWith(CONTENT_ROOT, [
      'log',
      '-n', '10',
      '--skip', '0',
      '--name-only',
      '--date=iso-strict',
      '--pretty=format:__COMMIT__%an|%ad',
    ])
  })

  it('skips blank lines between files', async () => {
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
