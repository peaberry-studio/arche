import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const updateSyncStateMock = vi.fn()
const getInstallationReposMock = vi.fn()
const auditEventMock = vi.fn()

const authState = {
  user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
}

vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => auditEventMock(...args),
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: () => null,
}))

vi.mock('@/lib/runtime/with-auth', () => ({
  withAuth: (_options: unknown, handler: (request: Request, context: unknown) => Promise<Response>) => {
    return async (request: Request, { params }: { params: Promise<{ slug: string }> }) => {
      const resolvedParams = await params
      return handler(request, {
        params: resolvedParams,
        sessionId: 'session-1',
        slug: resolvedParams.slug,
        user: authState.user,
      })
    }
  },
}))

vi.mock('@/lib/services', () => ({
  kbGithubRemoteService: {
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    decryptIntegrationConfig: (...args: unknown[]) => decryptIntegrationConfigMock(...args),
    updateSyncState: (...args: unknown[]) => updateSyncStateMock(...args),
  },
}))

vi.mock('@/lib/git/github-app-auth', () => ({
  getInstallationRepos: (...args: unknown[]) => getInstallationReposMock(...args),
}))

function makeRecord(overrides?: Partial<{ state: Record<string, unknown> }>) {
  return {
    singletonKey: 'kb_github_remote',
    config: 'enc:test',
    state: {
      installationId: 99,
      repoFullName: null,
      repoCloneUrl: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      remoteBranch: null,
      lastPushAt: null,
      lastPullAt: null,
      ...overrides?.state,
    },
    version: 1,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    updatedAt: new Date('2026-04-27T10:00:00Z'),
  }
}

describe('/api/u/[slug]/kb-github-remote/repos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    auditEventMock.mockResolvedValue(undefined)
    updateSyncStateMock.mockResolvedValue(undefined)
    findIntegrationMock.mockResolvedValue(makeRecord())
    decryptIntegrationConfigMock.mockReturnValue({
      appId: '12345',
      privateKey: 'pem-data',
    })
    getInstallationReposMock.mockResolvedValue({
      ok: true,
      repos: [
        { fullName: 'owner/repo1', cloneUrl: 'https://github.com/owner/repo1.git', private: false },
      ],
    })
  })

  describe('GET', () => {
    it('returns list of repos', async () => {
      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote/repos') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.repos).toEqual([
        { fullName: 'owner/repo1', cloneUrl: 'https://github.com/owner/repo1.git', private: false },
      ])
      expect(getInstallationReposMock).toHaveBeenCalledWith('12345', 'pem-data', 99)
    })

    it('returns 400 when not configured', async () => {
      findIntegrationMock.mockResolvedValue(null)

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote/repos') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
    })

    it('returns 400 when not installed', async () => {
      findIntegrationMock.mockResolvedValue(makeRecord({ state: { installationId: null } }))

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote/repos') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'not_installed' })
    })

    it('returns 502 when GitHub API fails', async () => {
      getInstallationReposMock.mockResolvedValue({ ok: false, message: 'API error' })

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote/repos') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(502)
    })
  })

  describe('PUT', () => {
    it('selects a repo and stores in state', async () => {
      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote/repos', {
          body: JSON.stringify({
            repoFullName: 'owner/repo1',
            repoCloneUrl: 'https://github.com/owner/repo1.git',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({ ok: true, repoFullName: 'owner/repo1' })
      expect(updateSyncStateMock).toHaveBeenCalledWith({
        repoFullName: 'owner/repo1',
        repoCloneUrl: 'https://github.com/owner/repo1.git',
      })
      expect(auditEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kb_github_remote.repo_selected',
        }),
      )
    })

    it('rejects missing repo data', async () => {
      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote/repos', {
          body: JSON.stringify({ repoFullName: 'owner/repo1' }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'missing_repo' })
    })

    it('returns 403 for non-admin users', async () => {
      authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote/repos', {
          body: JSON.stringify({
            repoFullName: 'owner/repo1',
            repoCloneUrl: 'https://github.com/owner/repo1.git',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(403)
    })
  })
})
