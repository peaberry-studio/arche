import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCleanupClone,
  mockCloneRepoToTemp,
  mockDetectDefaultBranch,
  mockHasBareRepoLayout,
  mockIsGitAvailable,
  mockMutateBareRepo,
  mockResolveRepoRoot,
  mockRunGit,
  mockLstat,
  mockMkdir,
  mockRealpath,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockCleanupClone: vi.fn(),
  mockCloneRepoToTemp: vi.fn(),
  mockDetectDefaultBranch: vi.fn(),
  mockHasBareRepoLayout: vi.fn(),
  mockIsGitAvailable: vi.fn(),
  mockMutateBareRepo: vi.fn(),
  mockResolveRepoRoot: vi.fn(),
  mockRunGit: vi.fn(),
  mockLstat: vi.fn(),
  mockMkdir: vi.fn(),
  mockRealpath: vi.fn(),
  mockWriteFile: vi.fn(),
}))

vi.mock('@/lib/git/bare-repo', () => ({
  cleanupClone: mockCleanupClone,
  cloneRepoToTemp: mockCloneRepoToTemp,
  detectDefaultBranch: mockDetectDefaultBranch,
  hasBareRepoLayout: mockHasBareRepoLayout,
  isGitAvailable: mockIsGitAvailable,
  mutateBareRepo: mockMutateBareRepo,
  resolveRepoRoot: mockResolveRepoRoot,
  runGit: mockRunGit,
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/data/kb/content.git'),
}))

vi.mock('node:fs/promises', () => ({
  lstat: mockLstat,
  mkdir: mockMkdir,
  realpath: mockRealpath,
  writeFile: mockWriteFile,
}))

import { captureKbArticleForReview } from '@/lib/mcp/kb-content-store'

describe('KB content store review snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveRepoRoot.mockResolvedValue('/data/kb/content.git')
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({
      ok: true,
      dir: '/tmp/arche-kb-clone',
      gitEnv: { GIT_CONFIG_GLOBAL: '/tmp/safe/gitconfig' },
      safeConfigDir: '/tmp/safe',
    })
    mockCleanupClone.mockResolvedValue(undefined)
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockRunGit
      .mockResolvedValueOnce({ ok: true, stdout: '' })
      .mockResolvedValueOnce({ ok: true, stdout: 'A new.md\n' })
      .mockResolvedValueOnce({ ok: true, stdout: '' })
      .mockResolvedValueOnce({ ok: false, stderr: 'non-fast-forward' })
    mockLstat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    mockMkdir.mockResolvedValue(undefined)
    mockRealpath.mockImplementation(async (value: string) => value)
    mockWriteFile.mockResolvedValue(undefined)
    mockMutateBareRepo.mockResolvedValue({ ok: false, error: 'conflict' })
  })

  it('reports a missing article without invoking bare-repository mutation', async () => {
    const result = await captureKbArticleForReview({ path: 'new.md' })

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(mockMutateBareRepo).not.toHaveBeenCalled()
  })
})
