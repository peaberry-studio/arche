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

  it('returns conflict when expectedHash does not match current content hash', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('{"existing":"data"}')
    mockHashContent.mockReturnValue('current-hash')

    const result = await writeCommonWorkspaceConfig('{"new":"data"}', 'stale-hash')
    expect(result).toEqual({ ok: false, error: 'conflict' })
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('returns success without committing when no changes detected (status empty)', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('{"key":"value"}')
    mockHashContent.mockReturnValue('matching-hash')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git status --porcelain (no changes)

    const result = await writeCommonWorkspaceConfig('{"key":"value"}', 'matching-hash')
    expect(result).toEqual({ ok: true, hash: 'matching-hash' })
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('commits and pushes when changes are detected', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT')) // no existing file
    mockHashContent.mockReturnValue('new-hash')
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: 'M CommonWorkspaceConfig.json\n' }) // git status
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git commit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git push

    const result = await writeCommonWorkspaceConfig('{"new":"config"}')
    expect(result).toEqual({ ok: true, hash: 'new-hash' })

    // Verify the write was performed
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(CLONE_DIR, 'CommonWorkspaceConfig.json'),
      '{"new":"config"}',
      'utf-8'
    )

    // Verify commit args include user config
    const commitCall = mockRunGit.mock.calls[2]
    expect(commitCall[0]).toEqual([
      '-c', 'user.name=Arche Config',
      '-c', 'user.email=config@arche.local',
      'commit',
      '-m', 'Update common workspace config',
    ])

    // Verify push target
    const pushCall = mockRunGit.mock.calls[3]
    expect(pushCall[0]).toEqual(['push', 'origin', 'HEAD:refs/heads/main'])
  })

  it('skips hash check when expectedHash is not provided', async () => {
    setupAvailableRepo()
    mockReadFile.mockResolvedValue('{"old":"content"}')
    mockHashContent.mockReturnValue('some-hash')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git status (no changes)

    const result = await writeCommonWorkspaceConfig('{"old":"content"}')
    expect(result).toEqual({ ok: true, hash: 'some-hash' })
  })

  it('skips hash check when current file is empty (read fails)', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockHashContent.mockReturnValue('hash-of-new')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: 'A CommonWorkspaceConfig.json\n' }) // git status
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git commit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git push
    mockDetectDefaultBranch.mockResolvedValue('main')

    // Even with expectedHash, if current is '' (from catch), and hashContent('') != expectedHash,
    // the check `current && hashContent(current) !== expectedHash` passes because current is ''
    // which is falsy, so the condition short-circuits
    const result = await writeCommonWorkspaceConfig('{"new":"data"}', 'any-hash')
    expect(result).toEqual({ ok: true, hash: 'hash-of-new' })
  })

  it('returns conflict on non-fast-forward push error', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockHashContent.mockReturnValue('hash')
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: 'M CommonWorkspaceConfig.json\n' }) // git status
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git commit
      .mockResolvedValueOnce({ ok: false, stderr: 'error: failed to push some refs: non-fast-forward' }) // push

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'conflict' })
  })

  it('returns write_failed on push error without non-fast-forward', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockHashContent.mockReturnValue('hash')
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: 'M CommonWorkspaceConfig.json\n' }) // git status
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git commit
      .mockResolvedValueOnce({ ok: false, stderr: 'fatal: remote error' }) // push

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'write_failed' })
  })

  it('returns write_failed when git add fails', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockRunGit.mockResolvedValueOnce({ ok: false, stderr: 'add error' })

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'write_failed' })
  })

  it('returns write_failed when git status fails', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: false, stderr: 'status error' }) // git status

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'write_failed' })
  })

  it('returns write_failed when git commit fails', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockHashContent.mockReturnValue('hash')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: 'M CommonWorkspaceConfig.json\n' }) // git status
      .mockResolvedValueOnce({ ok: false, stderr: 'commit error' }) // git commit

    const result = await writeCommonWorkspaceConfig('{}')
    expect(result).toEqual({ ok: false, error: 'write_failed' })
  })

  it('always calls cleanupClone in the write pipeline', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockRunGit.mockResolvedValueOnce({ ok: false, stderr: 'add error' })

    await writeCommonWorkspaceConfig('{}')
    expect(mockCleanupClone).toHaveBeenCalled()
  })

  it('creates parent directory before writing file', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git status (no changes)
    mockHashContent.mockReturnValue('h')

    await writeCommonWorkspaceConfig('content')

    expect(mockMkdir).toHaveBeenCalledWith(
      path.dirname(path.join(CLONE_DIR, 'CommonWorkspaceConfig.json')),
      { recursive: true }
    )
  })

  it('uses detectDefaultBranch for push target', async () => {
    setupAvailableRepo()
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockHashContent.mockReturnValue('hash')
    mockDetectDefaultBranch.mockResolvedValue('master')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
      .mockResolvedValueOnce({ ok: true, stdout: 'M CommonWorkspaceConfig.json\n' }) // git status
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git commit
      .mockResolvedValueOnce({ ok: true, stdout: '' }) // git push

    await writeCommonWorkspaceConfig('{}')

    const pushCall = mockRunGit.mock.calls[3]
    expect(pushCall[0]).toEqual(['push', 'origin', 'HEAD:refs/heads/master'])
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
