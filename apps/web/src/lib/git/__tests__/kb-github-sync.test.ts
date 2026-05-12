import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAddOrUpdateRemote = vi.fn()
const mockHasRemote = vi.fn()
const mockRemoveRemote = vi.fn()
const mockHasBareRepoLayout = vi.fn()
const mockIsGitAvailable = vi.fn()
const mockRunGit = vi.fn()
const mockGetKbContentRoot = vi.fn()
const mockGetKbSyncWorkingCopyRoot = vi.fn()
const mockGetInstallationToken = vi.fn()
const mockFsStat = vi.fn()
const mockFsReadFile = vi.fn()
const mockFsWriteFile = vi.fn()

vi.mock('@/lib/git/bare-repo', () => ({
  addOrUpdateRemote: (...args: unknown[]) => mockAddOrUpdateRemote(...args),
  hasRemote: (...args: unknown[]) => mockHasRemote(...args),
  removeRemote: (...args: unknown[]) => mockRemoveRemote(...args),
  hasBareRepoLayout: (...args: unknown[]) => mockHasBareRepoLayout(...args),
  isGitAvailable: (...args: unknown[]) => mockIsGitAvailable(...args),
  runGit: (...args: unknown[]) => mockRunGit(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: () => mockGetKbContentRoot(),
  getKbSyncWorkingCopyRoot: () => mockGetKbSyncWorkingCopyRoot(),
}))

vi.mock('@/lib/git/github-app-auth', () => ({
  getInstallationToken: (...args: unknown[]) => mockGetInstallationToken(...args),
}))

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockFsStat(...args),
  readFile: (...args: unknown[]) => mockFsReadFile(...args),
  writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
}))

const CREDS = {
  appId: '12345',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
  installationId: 99,
  repoCloneUrl: 'https://github.com/owner/repo.git',
}
const INSTALLATION_TOKEN = 'ghs_test_token_abc123'

describe('kb-github-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockFsReadFile.mockReset()
    mockFsStat.mockReset()
    mockFsWriteFile.mockReset()
    mockGetKbContentRoot.mockReturnValue('/kb-content')
    mockGetKbSyncWorkingCopyRoot.mockReturnValue('/kb-sync-wc')
    mockIsGitAvailable.mockResolvedValue(true)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockAddOrUpdateRemote.mockResolvedValue({ ok: true, stdout: '', stderr: '' })
    mockHasRemote.mockResolvedValue(false)
    mockRemoveRemote.mockResolvedValue({ ok: true, stdout: '', stderr: '' })
    mockGetInstallationToken.mockResolvedValue({
      ok: true,
      token: INSTALLATION_TOKEN,
      expiresAt: '2026-04-27T11:00:00Z',
    })
    // Default: bare repo has branch main
    mockRunGit.mockImplementation(async (args: string[]) => {
      if (args.includes('symbolic-ref') && args.includes('HEAD')) {
        return { ok: true, stdout: 'main\n', stderr: '' }
      }
      return { ok: true, stdout: '', stderr: '' }
    })
  })

  describe('buildAuthenticatedUrl', () => {
    it('injects token as x-access-token username', async () => {
      const { buildAuthenticatedUrl } = await import('../kb-github-sync')
      const result = buildAuthenticatedUrl('https://github.com/owner/repo.git', 'ghs_token')
      expect(result).toBe('https://x-access-token:ghs_token@github.com/owner/repo.git')
    })

    it('returns original URL on parse failure', async () => {
      const { buildAuthenticatedUrl } = await import('../kb-github-sync')
      const result = buildAuthenticatedUrl('not-a-url', 'ghs_token')
      expect(result).toBe('not-a-url')
    })
  })

  describe('sanitizeGitError', () => {
    it('strips token from error output', async () => {
      const { sanitizeGitError } = await import('../kb-github-sync')
      const result = sanitizeGitError(
        `fatal: Authentication failed for https://x-access-token:${INSTALLATION_TOKEN}@github.com/owner/repo.git`,
        INSTALLATION_TOKEN,
      )
      expect(result).not.toContain(INSTALLATION_TOKEN)
      expect(result).toContain('***')
    })

    it('returns original string when token is empty', async () => {
      const { sanitizeGitError } = await import('../kb-github-sync')
      const result = sanitizeGitError('some error', '')
      expect(result).toBe('some error')
    })
  })

  describe('ensureGithubRemote', () => {
    it('adds github remote to bare repo', async () => {
      const { ensureGithubRemote } = await import('../kb-github-sync')
      await ensureGithubRemote('https://github.com/owner/repo.git')

      expect(mockAddOrUpdateRemote).toHaveBeenCalledWith(
        '/kb-content',
        'github',
        'https://github.com/owner/repo.git',
      )
    })
  })

  describe('removeGithubRemote', () => {
    it('removes github remote when it exists', async () => {
      mockHasRemote.mockResolvedValue(true)

      const { removeGithubRemote } = await import('../kb-github-sync')
      await removeGithubRemote()

      expect(mockRemoveRemote).toHaveBeenCalledWith('/kb-content', 'github')
    })

    it('does nothing when remote does not exist', async () => {
      mockHasRemote.mockResolvedValue(false)

      const { removeGithubRemote } = await import('../kb-github-sync')
      await removeGithubRemote()

      expect(mockRemoveRemote).not.toHaveBeenCalled()
    })
  })

  describe('pushToGithub', () => {
    it('pushes bare repo to GitHub successfully', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('push')) return { ok: true, stdout: '', stderr: '' }
        if (args.includes('rev-parse')) return { ok: true, stdout: 'abc123\n', stderr: '' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'pushed', commitHash: 'abc123', branch: 'main' })
      expect(mockGetInstallationToken).toHaveBeenCalledWith('12345', CREDS.privateKey, 99)
      // Should set authenticated URL then clear it
      expect(mockAddOrUpdateRemote).toHaveBeenCalledWith(
        '/kb-content', 'github', expect.stringContaining('x-access-token'),
      )
    })

    it('returns up_to_date when nothing to push', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('push')) return { ok: true, stdout: '', stderr: 'Everything up-to-date' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'up_to_date', branch: 'main' })
    })

    it('returns push_rejected on non-fast-forward', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('push')) return { ok: false, stdout: '', stderr: 'error: failed to push some refs (non-fast-forward)' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('push_rejected')
        expect(result.message).toContain('Pull from GitHub first')
        expect(result.detail).toBeDefined()
        expect(result.detail).not.toContain(INSTALLATION_TOKEN)
      }
    })

    it('returns auth_failed on authentication error', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('push')) return { ok: false, stdout: '', stderr: 'Authentication failed for https://github.com/owner/repo.git' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe('auth_failed')
    })

    it('returns auth_failed when token acquisition fails', async () => {
      mockGetInstallationToken.mockResolvedValue({
        ok: false,
        status: 'auth_failed',
        message: 'GitHub App credentials are invalid',
      })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('auth_failed')
        expect(result.message).toBe('GitHub App credentials are invalid')
      }
    })

    it('returns kb_unavailable when bare repo missing', async () => {
      mockHasBareRepoLayout.mockResolvedValue(false)

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe('kb_unavailable')
    })

    it('returns kb_unavailable when git is not available', async () => {
      mockIsGitAvailable.mockResolvedValue(false)

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe('kb_unavailable')
    })

    it('maps non-auth token failure to error status', async () => {
      mockGetInstallationToken.mockResolvedValue({
        ok: false,
        status: 'not_found',
        message: 'Installation not found',
      })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
        expect(result.message).toBe('Installation not found')
      }
    })

    it('returns error on unexpected exception', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('push')) throw new Error('disk full')
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
        expect(result.message).toContain('unexpected error')
        expect(result.detail).toBe('disk full')
      }
    })
  })

  describe('pullFromGithub', () => {
    it('fast-forwards when local is behind', async () => {
      let revParseLocalCallCount = 0
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('fetch') && args.includes('github')) return { ok: true, stdout: '', stderr: '' }
        if (args.includes('merge-base') && args.includes('--is-ancestor')) {
          if (args.includes('refs/heads/main')) return { ok: true, stdout: '', stderr: '' }
          return { ok: false, stdout: '', stderr: '' }
        }
        if (args.includes('rev-parse') && args.includes('refs/remotes/github/main')) return { ok: true, stdout: 'bbb222\n', stderr: '' }
        if (args.includes('rev-parse') && args.includes('refs/heads/main')) {
          revParseLocalCallCount++
          // First call: compare hashes (before update-ref). Second call: get final commit hash (after update-ref)
          return { ok: true, stdout: revParseLocalCallCount === 1 ? 'aaa111\n' : 'bbb222\n', stderr: '' }
        }
        if (args.includes('update-ref')) return { ok: true, stdout: '', stderr: '' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'pulled', commitHash: 'bbb222', branch: 'main' })
      expect(mockRunGit).toHaveBeenCalledWith([
        '--git-dir',
        '/kb-content',
        'fetch',
        'github',
        '+refs/heads/main:refs/remotes/github/main',
      ])
    })

    it('keeps an existing pending merge instead of starting another pull', async () => {
      mockFsStat.mockResolvedValue({ isDirectory: () => true })
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('MERGE_HEAD')) return { ok: true, stdout: 'merge-head\n', stderr: '' }
        if (args.includes('diff') && args.includes('--diff-filter=U')) {
          return { ok: true, stdout: 'docs/conflict.md\n', stderr: '' }
        }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result).toEqual({
        ok: false,
        status: 'conflicts',
        message: 'Merge conflicts in 1 file(s)',
        conflictingFiles: ['docs/conflict.md'],
      })
      expect(mockGetInstallationToken).not.toHaveBeenCalled()
    })

    it('returns up_to_date when hashes match', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('fetch')) return { ok: true, stdout: '', stderr: '' }
        if (args.includes('merge-base') && args.includes('--is-ancestor') && args.includes('refs/heads/main')) {
          return { ok: true, stdout: '', stderr: '' }
        }
        if (args.includes('rev-parse')) return { ok: true, stdout: 'same_hash\n', stderr: '' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'up_to_date', branch: 'main' })
    })

    it('returns up_to_date when local is ahead', async () => {
      let isAncestorCallCount = 0
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('fetch')) return { ok: true, stdout: '', stderr: '' }
        if (args.includes('merge-base') && args.includes('--is-ancestor')) {
          isAncestorCallCount++
          if (isAncestorCallCount === 1) return { ok: false, stdout: '', stderr: '' } // local is NOT ancestor of remote
          if (isAncestorCallCount === 2) return { ok: true, stdout: '', stderr: '' } // remote IS ancestor of local
        }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'up_to_date', branch: 'main' })
    })

    it('returns auth_failed on fetch authentication error', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('fetch')) return { ok: false, stdout: '', stderr: 'Authentication failed' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe('auth_failed')
    })

    it('returns auth_failed when token acquisition fails', async () => {
      mockGetInstallationToken.mockResolvedValue({
        ok: false,
        status: 'auth_failed',
        message: 'GitHub App credentials are invalid',
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe('auth_failed')
    })

    it('returns kb_unavailable when bare repo missing', async () => {
      mockHasBareRepoLayout.mockResolvedValue(false)

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe('kb_unavailable')
    })

    it('returns error on non-auth fetch failure', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('fetch')) return { ok: false, stdout: '', stderr: 'fatal: could not read from remote repository' }
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe('error')
    })

    it('returns error on unexpected exception', async () => {
      mockRunGit.mockImplementation(async (args: string[]) => {
        if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
        if (args.includes('fetch')) throw new Error('unexpected git crash')
        return { ok: true, stdout: '', stderr: '' }
      })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
        expect(result.message).toContain('unexpected error')
        expect(result.detail).toBe('unexpected git crash')
      }
    })

    describe('diverged — merge in sync working copy', () => {
      function setupDiverged() {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('symbolic-ref') && args.includes('HEAD')) {
            return { ok: true, stdout: 'main\n', stderr: '' }
          }
          if (args.includes('fetch') && args.includes('github') && !args.some((a: string) => typeof a === 'string' && a.startsWith('/'))) {
            // fetch in working copy context
            return { ok: true, stdout: '', stderr: '' }
          }
          if (args[0] === '--git-dir' && args.includes('fetch')) {
            return { ok: true, stdout: '', stderr: '' }
          }
          if (args.includes('merge-base') && args.includes('--is-ancestor')) {
            // Both return false = diverged
            return { ok: false, stdout: '', stderr: '' }
          }
          if (args.includes('clone')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('checkout') && args.includes('main')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('merge') && args.includes('github/main')) {
            return { ok: true, stdout: 'Merge made by the recursive strategy.', stderr: '' }
          }
          if (args.includes('push') && args.includes('origin')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('rev-parse') && args.includes('HEAD')) return { ok: true, stdout: 'merged123\n', stderr: '' }
          return { ok: true, stdout: '', stderr: '' }
        })
      }

      it('merges successfully in sync working copy and pushes back', async () => {
        setupDiverged()

        const { pullFromGithub } = await import('../kb-github-sync')
        const result = await pullFromGithub(CREDS)

        expect(result).toEqual({ ok: true, status: 'pulled', commitHash: 'merged123', branch: 'main' })
      })

      it('returns conflicts when merge fails with conflict markers', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
          if (args[0] === '--git-dir' && args.includes('fetch')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('merge-base') && args.includes('--is-ancestor')) {
            return { ok: false, stdout: '', stderr: '' }
          }
          if (args.includes('clone')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('checkout') && args.includes('main')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('fetch') && args.includes('github')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('merge') && args.includes('github/main')) {
            return { ok: false, stdout: 'CONFLICT (content): Merge conflict in article.md', stderr: '' }
          }
          if (args.includes('diff') && args.includes('--name-only') && args.includes('--diff-filter=U')) {
            return { ok: true, stdout: 'article.md\npage.md\n', stderr: '' }
          }
          return { ok: true, stdout: '', stderr: '' }
        })

        const { pullFromGithub } = await import('../kb-github-sync')
        const result = await pullFromGithub(CREDS)

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.status).toBe('conflicts')
          expect(result.conflictingFiles).toEqual(['article.md', 'page.md'])
        }
      })

      it('returns error when merge fails without conflict markers', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
          if (args[0] === '--git-dir' && args.includes('fetch')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('merge-base')) return { ok: false, stdout: '', stderr: '' }
          if (args.includes('clone')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('checkout') && args.includes('main')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('fetch') && args.includes('github')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('merge') && args.includes('github/main')) {
            return { ok: false, stdout: '', stderr: 'fatal: refusing to merge unrelated histories' }
          }
          if (args.includes('merge') && args.includes('--abort')) return { ok: true, stdout: '', stderr: '' }
          return { ok: true, stdout: '', stderr: '' }
        })

        const { pullFromGithub } = await import('../kb-github-sync')
        const result = await pullFromGithub(CREDS)

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.status).toBe('error')
          expect(result.message).toContain('Merge failed')
          expect(result.detail).toBeDefined()
        }
      })

      it('returns error when pushBack to bare repo fails after merge', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('symbolic-ref')) return { ok: true, stdout: 'main\n', stderr: '' }
          if (args[0] === '--git-dir' && args.includes('fetch')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('merge-base')) return { ok: false, stdout: '', stderr: '' }
          if (args.includes('clone')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('checkout') && args.includes('main')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('fetch') && args.includes('github')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('merge') && args.includes('github/main')) return { ok: true, stdout: '', stderr: '' }
          if (args.includes('push') && args.includes('origin')) return { ok: false, stdout: '', stderr: 'push failed' }
          return { ok: true, stdout: '', stderr: '' }
        })

        const { pullFromGithub } = await import('../kb-github-sync')
        const result = await pullFromGithub(CREDS)

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.status).toBe('error')
          expect(result.message).toContain('failed to update the knowledge base')
        }
      })
    })
  })

  describe('conflict management', () => {
    describe('hasPendingSyncConflicts', () => {
      it('returns false when sync wc does not exist', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        const { hasPendingSyncConflicts } = await import('../kb-github-sync')
        expect(await hasPendingSyncConflicts()).toBe(false)
      })

      it('returns true when MERGE_HEAD exists', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('MERGE_HEAD')) return { ok: true, stdout: 'abc123\n', stderr: '' }
          return { ok: true, stdout: '', stderr: '' }
        })

        const { hasPendingSyncConflicts } = await import('../kb-github-sync')
        expect(await hasPendingSyncConflicts()).toBe(true)
      })

      it('returns false when no MERGE_HEAD', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('MERGE_HEAD')) return { ok: false, stdout: '', stderr: '' }
          return { ok: true, stdout: '', stderr: '' }
        })

        const { hasPendingSyncConflicts } = await import('../kb-github-sync')
        expect(await hasPendingSyncConflicts()).toBe(false)
      })
    })

    describe('listSyncConflicts', () => {
      it('returns empty when sync wc does not exist', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        const { listSyncConflicts } = await import('../kb-github-sync')
        expect(await listSyncConflicts()).toEqual([])
      })

      it('returns conflicted file list', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockResolvedValue({ ok: true, stdout: 'file1.md\nfile2.md\n', stderr: '' })

        const { listSyncConflicts } = await import('../kb-github-sync')
        expect(await listSyncConflicts()).toEqual(['file1.md', 'file2.md'])
      })
    })

    describe('getSyncConflictDetail', () => {
      it('returns null when sync wc does not exist', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        const { getSyncConflictDetail } = await import('../kb-github-sync')
        expect(await getSyncConflictDetail('file.md')).toBeNull()
      })

      it('rejects paths outside the sync working copy', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })

        const { getSyncConflictDetail } = await import('../kb-github-sync')
        expect(await getSyncConflictDetail('../secret.md')).toBeNull()
        expect(mockFsReadFile).not.toHaveBeenCalled()
      })

      it('returns ours/theirs/base/working content', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes(':2:file.md')) return { ok: true, stdout: 'local content', stderr: '' }
          if (args.includes(':3:file.md')) return { ok: true, stdout: 'remote content', stderr: '' }
          if (args.includes(':1:file.md')) return { ok: true, stdout: 'base content', stderr: '' }
          return { ok: true, stdout: '', stderr: '' }
        })
        mockFsReadFile.mockResolvedValue('working content with markers')

        const { getSyncConflictDetail } = await import('../kb-github-sync')
        const detail = await getSyncConflictDetail('file.md')

        expect(detail).toEqual({
          path: 'file.md',
          ours: 'local content',
          theirs: 'remote content',
          base: 'base content',
          working: 'working content with markers',
        })
      })
    })

    describe('resolveSyncConflict', () => {
      it('throws when sync wc does not exist', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        const { resolveSyncConflict } = await import('../kb-github-sync')
        await expect(resolveSyncConflict('file.md', 'ours')).rejects.toThrow('No sync working copy exists')
      })

      it('checks out ours and stages the file', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockResolvedValue({ ok: true, stdout: '', stderr: '' })

        const { resolveSyncConflict } = await import('../kb-github-sync')
        await resolveSyncConflict('file.md', 'ours')

        expect(mockRunGit).toHaveBeenCalledWith(
          ['checkout', '--ours', '--', 'file.md'],
          expect.objectContaining({ cwd: '/kb-sync-wc' }),
        )
        expect(mockRunGit).toHaveBeenCalledWith(
          ['add', '--', 'file.md'],
          expect.objectContaining({ cwd: '/kb-sync-wc' }),
        )
      })

      it('writes custom content when provided', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockResolvedValue({ ok: true, stdout: '', stderr: '' })
        mockFsWriteFile.mockResolvedValue(undefined)

        const { resolveSyncConflict } = await import('../kb-github-sync')
        await resolveSyncConflict('file.md', 'ours', 'custom merged content')

        expect(mockFsWriteFile).toHaveBeenCalledWith('/kb-sync-wc/file.md', 'custom merged content', 'utf-8')
      })

      it('rejects paths outside the sync working copy', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })

        const { resolveSyncConflict } = await import('../kb-github-sync')
        await expect(resolveSyncConflict('../secret.md', 'ours', 'content')).rejects.toThrow('Invalid conflict path')
        expect(mockFsWriteFile).not.toHaveBeenCalled()
      })
    })

    describe('finalizeSyncMerge', () => {
      it('returns error when sync wc does not exist', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        const { finalizeSyncMerge } = await import('../kb-github-sync')
        const result = await finalizeSyncMerge()

        expect(result.ok).toBe(false)
      })

      it('returns error when conflicts remain', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockResolvedValue({ ok: true, stdout: 'still-conflicted.md\n', stderr: '' })

        const { finalizeSyncMerge } = await import('../kb-github-sync')
        const result = await finalizeSyncMerge()

        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.message).toContain('unresolved')
      })

      it('commits and pushes back on success', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        const callOrder: string[] = []
        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('diff') && args.includes('--diff-filter=U')) {
            return { ok: true, stdout: '\n', stderr: '' }
          }
          if (args.includes('commit')) {
            callOrder.push('commit')
            return { ok: true, stdout: '', stderr: '' }
          }
          if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
            return { ok: true, stdout: 'main\n', stderr: '' }
          }
          if (args.includes('push') && args.includes('origin')) {
            callOrder.push('push')
            return { ok: true, stdout: '', stderr: '' }
          }
          if (args.includes('rev-parse') && args.includes('HEAD')) {
            return { ok: true, stdout: 'final123\n', stderr: '' }
          }
          return { ok: true, stdout: '', stderr: '' }
        })

        const { finalizeSyncMerge } = await import('../kb-github-sync')
        const result = await finalizeSyncMerge()

        expect(result).toEqual({ ok: true, commitHash: 'final123', branch: 'main' })
        expect(callOrder).toEqual(['commit', 'push'])
      })
    })

    describe('abortSyncMerge', () => {
      it('does nothing when sync wc does not exist', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'))

        const { abortSyncMerge } = await import('../kb-github-sync')
        await abortSyncMerge()

        expect(mockRunGit).not.toHaveBeenCalledWith(
          expect.arrayContaining(['merge', '--abort']),
          expect.any(Object),
        )
      })

      it('aborts merge and resets', async () => {
        mockFsStat.mockResolvedValue({ isDirectory: () => true })
        mockRunGit.mockImplementation(async (args: string[]) => {
          if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
            return { ok: true, stdout: 'main\n', stderr: '' }
          }
          return { ok: true, stdout: '', stderr: '' }
        })

        const { abortSyncMerge } = await import('../kb-github-sync')
        await abortSyncMerge()

        expect(mockRunGit).toHaveBeenCalledWith(
          ['merge', '--abort'],
          expect.objectContaining({ cwd: '/kb-sync-wc' }),
        )
        expect(mockRunGit).toHaveBeenCalledWith(
          ['reset', '--hard', 'origin/main'],
          expect.objectContaining({ cwd: '/kb-sync-wc' }),
        )
      })
    })
  })
})
