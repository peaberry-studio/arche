import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCloneRepoToTemp = vi.fn()
const mockCleanupClone = vi.fn()
const mockDetectDefaultBranch = vi.fn()
const mockHasBareRepoLayout = vi.fn()
const mockIsGitAvailable = vi.fn()
const mockRunGit = vi.fn()
const mockGetKbContentRoot = vi.fn()

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

const REPO_URL = 'https://github.com/owner/repo.git'
const PAT = 'ghp_secret123'
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
  })

  describe('buildAuthenticatedUrl', () => {
    it('injects PAT into HTTPS URL', async () => {
      const { buildAuthenticatedUrl } = await import('../kb-github-sync')
      const result = buildAuthenticatedUrl('https://github.com/owner/repo.git', 'ghp_abc')
      expect(result).toBe('https://ghp_abc@github.com/owner/repo.git')
    })

    it('returns original URL on parse failure', async () => {
      const { buildAuthenticatedUrl } = await import('../kb-github-sync')
      const result = buildAuthenticatedUrl('not-a-url', 'ghp_abc')
      expect(result).toBe('not-a-url')
    })
  })

  describe('sanitizeGitError', () => {
    it('strips PAT from error output', async () => {
      const { sanitizeGitError } = await import('../kb-github-sync')
      const result = sanitizeGitError(
        'fatal: Authentication failed for https://ghp_secret123@github.com/owner/repo.git',
        'ghp_secret123',
      )
      expect(result).not.toContain('ghp_secret123')
      expect(result).toContain('***')
    })

    it('returns original string when PAT is empty', async () => {
      const { sanitizeGitError } = await import('../kb-github-sync')
      const result = sanitizeGitError('some error', '')
      expect(result).toBe('some error')
    })
  })

  describe('testConnection', () => {
    it('returns success with remote branch name', async () => {
      mockRunGit.mockResolvedValue({
        ok: true,
        stdout: 'abc123\trefs/heads/main\ndef456\trefs/heads/develop\n',
      })

      const { testConnection } = await import('../kb-github-sync')
      const result = await testConnection(REPO_URL, PAT)

      expect(result).toEqual({ ok: true, remoteBranch: 'main' })
      expect(mockRunGit).toHaveBeenCalledWith(
        ['ls-remote', '--heads', expect.stringContaining('ghp_secret123@github.com')],
      )
    })

    it('detects authentication failure', async () => {
      mockRunGit.mockResolvedValue({
        ok: false,
        stderr: 'fatal: Authentication failed for https://ghp_secret123@github.com/owner/repo.git',
      })

      const { testConnection } = await import('../kb-github-sync')
      const result = await testConnection(REPO_URL, PAT)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('auth_failed')
        expect(result.message).not.toContain(PAT)
      }
    })

    it('detects repository not found', async () => {
      mockRunGit.mockResolvedValue({
        ok: false,
        stderr: 'ERROR: Repository not found.',
      })

      const { testConnection } = await import('../kb-github-sync')
      const result = await testConnection(REPO_URL, PAT)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('repo_not_found')
      }
    })

    it('returns error when git is not available', async () => {
      mockIsGitAvailable.mockResolvedValue(false)

      const { testConnection } = await import('../kb-github-sync')
      const result = await testConnection(REPO_URL, PAT)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('error')
      }
    })
  })

  describe('pushToGithub', () => {
    it('pushes successfully and returns commit hash', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stderr: '' }) // push
        .mockResolvedValueOnce({ ok: true, stdout: 'abc123\n' }) // rev-parse

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(REPO_URL, PAT)

      expect(result).toEqual({ ok: true, status: 'pushed', commitHash: 'abc123' })
      expect(mockCleanupClone).toHaveBeenCalled()
    })

    it('returns up_to_date when nothing to push', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stderr: 'Everything up-to-date' }) // push
        .mockResolvedValueOnce({ ok: true, stdout: 'abc123\n' }) // rev-parse

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(REPO_URL, PAT)

      expect(result).toEqual({ ok: true, status: 'up_to_date' })
    })

    it('returns push_rejected on non-fast-forward', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: 'error: failed to push some refs (non-fast-forward)' })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(REPO_URL, PAT)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('push_rejected')
        expect(result.message).not.toContain(PAT)
      }
    })

    it('returns auth_failed on authentication error during push', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: `Authentication failed for https://${PAT}@github.com/owner/repo.git` })

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(REPO_URL, PAT)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('auth_failed')
        expect(result.message).not.toContain(PAT)
      }
    })

    it('returns kb_unavailable when bare repo missing', async () => {
      mockHasBareRepoLayout.mockResolvedValue(false)

      const { pushToGithub } = await import('../kb-github-sync')
      const result = await pushToGithub(REPO_URL, PAT)

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
      await pushToGithub(REPO_URL, PAT)

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
      const result = await pullFromGithub(REPO_URL, PAT)

      expect(result).toEqual({ ok: true, status: 'pulled', commitHash: 'def456' })
      expect(mockCleanupClone).toHaveBeenCalled()
    })

    it('returns up_to_date when no differences', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // fetch
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // diff --quiet (no differences)

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(REPO_URL, PAT)

      expect(result).toEqual({ ok: true, status: 'up_to_date' })
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
      const result = await pullFromGithub(REPO_URL, PAT)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('conflicts')
        expect(result.conflictingFiles).toEqual(['article1.md', 'article2.md'])
      }
    })

    it('returns auth_failed on fetch authentication error', async () => {
      mockRunGit
        .mockResolvedValueOnce({ ok: true, stdout: '' }) // remote add
        .mockResolvedValueOnce({ ok: false, stderr: `Authentication failed for https://${PAT}@github.com/owner/repo.git` })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(REPO_URL, PAT)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe('auth_failed')
        expect(result.message).not.toContain(PAT)
      }
    })

    it('returns kb_unavailable when clone fails', async () => {
      mockCloneRepoToTemp.mockResolvedValue({ ok: false })

      const { pullFromGithub } = await import('../kb-github-sync')
      const result = await pullFromGithub(REPO_URL, PAT)

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
      await pullFromGithub(REPO_URL, PAT)

      expect(mockCleanupClone).toHaveBeenCalledWith(CLONE_RESULT)
    })
  })
})
