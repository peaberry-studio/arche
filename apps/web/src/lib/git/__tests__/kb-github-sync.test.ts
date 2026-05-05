import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCloneRepoToTemp = vi.fn()
const mockCleanupClone = vi.fn()
const mockDetectDefaultBranch = vi.fn()
const mockHasBareRepoLayout = vi.fn()
const mockIsGitAvailable = vi.fn()
const mockRunGit = vi.fn()
const mockGetKbContentRoot = vi.fn()
const mockGetInstallationToken = vi.fn()

vi.mock('@/lib/git/bare-repo', () => ({
  cloneRepoToTemp: (...args: unknown[]) => mockCloneRepoToTemp(...args),
  cleanupClone: (...args: unknown[]) => mockCleanupClone(...args),
  detectDefaultBranch: (...args: unknown[]) => mockDetectDefaultBranch(...args),
  hasBareRepoLayout: (...args: unknown[]) => mockHasBareRepoLayout(...args),
  isGitAvailable: (...args: unknown[]) => mockIsGitAvailable(...args),
  runGit: (...args: unknown[]) => mockRunGit(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: () => mockGetKbContentRoot(),
}))

vi.mock('@/lib/git/github-app-auth', () => ({
  getInstallationToken: (...args: unknown[]) => mockGetInstallationToken(...args),
}))

const CREDS = {
  appId: '12345',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
  installationId: 99,
  repoCloneUrl: 'https://github.com/owner/repo.git',
}
const INSTALLATION_TOKEN = 'ghs_test_token_abc123'
const CLONE_RESULT = {
  ok: true,
  dir: '/tmp/arche-kb-test',
  gitEnv: { GIT_CONFIG_GLOBAL: '/tmp/safe/gitconfig' },
  safeConfigDir: '/tmp/safe',
}

describe('kb-github-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetKbContentRoot.mockReturnValue('/kb-content')
    mockIsGitAvailable.mockResolvedValue(true)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue(CLONE_RESULT)
    mockCleanupClone.mockResolvedValue(undefined)
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockGetInstallationToken.mockResolvedValue({
      ok: true,
      token: INSTALLATION_TOKEN,
      expiresAt: '2026-04-27T11:00:00Z',
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

  describe('pushToGithub', () => {
    it('acquires token and pushes successfully', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stderr: '' }) // push
        .mockResolvedValueOnce({ ok: true, stdout: 'abc123\n' }) // rev-parse

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'pushed', commitHash: 'abc123', branch: 'main' })
      expect(mockGetInstallationToken).toHaveBeenCalledWith('12345', CREDS.privateKey, 99)
      expect(mockRunGit).toHaveBeenCalledWith(
        ['remote', 'add', 'github', expect.stringContaining('x-access-token')],
        expect.any(Object),
      )
      expect(mockCleanupClone).toHaveBeenCalled()
    })

    it('returns up_to_date when nothing to push', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stderr: 'Everything up-to-date' }) // push
        .mockResolvedValueOnce({ ok: true, stdout: 'abc123\n' }) // rev-parse

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'up_to_date', branch: 'main' })
    })

    it('returns push_rejected on non-fast-forward', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: 'error: failed to push some refs (non-fast-forward)' })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('push_rejected')
        expect(result.message).not.toContain(INSTALLATION_TOKEN)
      }
    })

    it('returns auth_failed on authentication error during push', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: 'Authentication failed for https://github.com/owner/repo.git' })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('auth_failed')
      }
    })

    it('returns auth_failed when installation token acquisition fails', async () => {
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
      if (!result.ok) {
        expect(result.status).toBe('kb_unavailable')
      }
    })

    it('cleans up clone on failure', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: 'some error' })

      const { pushToGithub } = await import('../kb-github-sync')
      await pushToGithub(CREDS)

      expect(mockCleanupClone).toHaveBeenCalledWith(CLONE_RESULT)
    })
  })

  describe('pullFromGithub', () => {
    it('pulls successfully and pushes back to bare repo', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: false, stderr: '' }) // diff --quiet (differences exist)
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // merge
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // push back
        .mockResolvedValueOnce({ ok: true, stdout: 'def456\n' }) // rev-parse

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'pulled', commitHash: 'def456', branch: 'main' })
      expect(mockGetInstallationToken).toHaveBeenCalledWith('12345', CREDS.privateKey, 99)
      expect(mockCleanupClone).toHaveBeenCalled()
    })

    it('returns up_to_date when no differences', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // diff --quiet (no differences)

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result).toEqual({ ok: true, status: 'up_to_date', branch: 'main' })
    })

    it('returns conflicts with file list on merge failure', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: false, stderr: '' }) // diff --quiet
        .mockResolvedValueOnce({ ok: false, stderr: 'CONFLICT (content)' }) // merge
        .mockResolvedValueOnce({ ok: true, stdout: 'article1.md\narticle2.md\n' }) // diff --name-only
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // merge --abort

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('conflicts')
        expect(result.conflictingFiles).toEqual(['article1.md', 'article2.md'])
      }
    })

    it('returns auth_failed on fetch authentication error', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: 'Authentication failed for https://github.com/owner/repo.git' })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('auth_failed')
        expect(result.message).not.toContain(INSTALLATION_TOKEN)
      }
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
      if (!result.ok) {
        expect(result.status).toBe('auth_failed')
      }
    })

    it('returns kb_unavailable when clone fails', async () => {
      mockCloneRepoToTemp.mockResolvedValue({ ok: false })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('kb_unavailable')
      }
    })

    it('cleans up clone on merge conflict', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: false, stderr: '' }) // diff --quiet
        .mockResolvedValueOnce({ ok: false, stderr: 'CONFLICT' }) // merge
        .mockResolvedValueOnce({ ok: true, stdout: 'file.md\n' }) // diff --name-only
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // merge --abort

      const { pullFromGithub } = await import('../kb-github-sync')
      await pullFromGithub(CREDS)

      expect(mockCleanupClone).toHaveBeenCalledWith(CLONE_RESULT)
    })

    it('returns error when pushBack fails after merge', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: false, stderr: '' }) // diff --quiet
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // merge
        .mockResolvedValueOnce({ ok: false, stderr: 'push failed' }) // push back

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
        expect(result.message).toContain('failed to update local repository')
      }
    })

    it('returns error on unexpected exception', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockRejectedValueOnce(new Error('unexpected git crash'))

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
        expect(result.message).toBe('unexpected git crash')
      }
      expect(mockCleanupClone).toHaveBeenCalled()
    })

    it('returns error on non-auth fetch failure', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: 'fatal: could not read from remote repository' })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
      }
    })

    it('resolves conflicts with local_wins strategy', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: false, stderr: '' }) // diff --quiet
        .mockResolvedValueOnce({ ok: false, stderr: 'CONFLICT' }) // merge
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // checkout --ours
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // commit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // push back
        .mockResolvedValueOnce({ ok: true, stdout: 'abc123\n' }) // rev-parse

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS, 'local_wins')

      expect(result).toEqual({ ok: true, status: 'resolved', commitHash: 'abc123', branch: 'main' })
      expect(mockRunGit).toHaveBeenCalledWith(
        ['checkout', '--ours', '.'],
        expect.any(Object),
      )
    })

    it('resolves conflicts with remote_wins strategy', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: false, stderr: '' }) // diff --quiet
        .mockResolvedValueOnce({ ok: false, stderr: 'CONFLICT' }) // merge
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // checkout --theirs
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // git add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // commit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // push back
        .mockResolvedValueOnce({ ok: true, stdout: 'def456\n' }) // rev-parse

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(CREDS, 'remote_wins')

      expect(result).toEqual({ ok: true, status: 'resolved', commitHash: 'def456', branch: 'main' })
      expect(mockRunGit).toHaveBeenCalledWith(
        ['checkout', '--theirs', '.'],
        expect.any(Object),
      )
    })
  })

  describe('prepareSyncWorkspace (via pushToGithub)', () => {
    it('returns kb_unavailable when git is not available', async () => {
      mockIsGitAvailable.mockResolvedValue(false)

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('kb_unavailable')
        expect(result.message).toContain('Git is not available')
      }
    })

    it('returns kb_unavailable when clone fails', async () => {
      mockCloneRepoToTemp.mockResolvedValue({ ok: false })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('kb_unavailable')
        expect(result.message).toContain('Failed to clone')
      }
    })

    it('returns error and cleans up when addRemote fails', async () => {
      mockRunGit.mockResolvedValueOnce({ ok: false, stderr: 'remote already exists' })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
      }
      expect(mockCleanupClone).toHaveBeenCalledWith(CLONE_RESULT)
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
  })

  describe('pushToGithub edge cases', () => {
    it('returns error on unexpected exception', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockRejectedValueOnce(new Error('disk full'))

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
        expect(result.message).toBe('disk full')
      }
      expect(mockCleanupClone).toHaveBeenCalled()
    })

    it('returns generic error on push failure (not auth, not rejected)', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: 'fatal: unexpected error' })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(CREDS)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
      }
    })
  })
})
