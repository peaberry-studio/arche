import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCleanupClone = vi.fn()
const mockCloneRepoToTemp = vi.fn()
const mockDetectDefaultBranch = vi.fn()
const mockHasBareRepoLayout = vi.fn()
const mockHashContent = vi.fn()
const mockIsGitAvailable = vi.fn()
const mockResolveRepoRoot = vi.fn()
const mockRunGit = vi.fn()
const mockRunGitOnBareRepo = vi.fn()

vi.mock('@/lib/git/bare-repo', () => ({
  cleanupClone: (...args: unknown[]) => mockCleanupClone(...args),
  cloneRepoToTemp: (...args: unknown[]) => mockCloneRepoToTemp(...args),
  detectDefaultBranch: (...args: unknown[]) => mockDetectDefaultBranch(...args),
  hasBareRepoLayout: (...args: unknown[]) => mockHasBareRepoLayout(...args),
  hashContent: (...args: unknown[]) => mockHashContent(...args),
  isGitAvailable: (...args: unknown[]) => mockIsGitAvailable(...args),
  resolveRepoRoot: (...args: unknown[]) => mockResolveRepoRoot(...args),
  runGit: (...args: unknown[]) => mockRunGit(...args),
  runGitOnBareRepo: (...args: unknown[]) => mockRunGitOnBareRepo(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbConfigRoot: vi.fn(() => '/kb-config'),
  getKbContentRoot: vi.fn(() => '/kb-content'),
}))

import { listRecentKbFileUpdates } from '@/lib/common-workspace-config-store'

describe('listRecentKbFileUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveRepoRoot.mockResolvedValue('/kb-content/repo.git')
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
  })

  it('pages git history until it collects the requested number of unique files', async () => {
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

    expect(mockRunGitOnBareRepo).toHaveBeenNthCalledWith(1, '/kb-content/repo.git', [
      'log',
      '-n', '2',
      '--skip', '0',
      '--name-only',
      '--date=iso-strict',
      '--pretty=format:__COMMIT__%an|%ad',
    ])
    expect(mockRunGitOnBareRepo).toHaveBeenNthCalledWith(2, '/kb-content/repo.git', [
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
})
