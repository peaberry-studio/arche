import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const saveIntegrationConfigMock = vi.fn()
const clearIntegrationMock = vi.fn()
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
    saveIntegrationConfig: (...args: unknown[]) => saveIntegrationConfigMock(...args),
    clearIntegration: (...args: unknown[]) => clearIntegrationMock(...args),
  },
}))

function makeRecord(overrides?: Partial<{ version: number; updatedAt: Date; state: Record<string, unknown> }>) {
  return {
    singletonKey: 'kb_github_remote',
    config: 'enc:test',
    state: {
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      remoteBranch: null,
      lastPushAt: null,
      lastPullAt: null,
      ...overrides?.state,
    },
    version: overrides?.version ?? 1,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    updatedAt: overrides?.updatedAt ?? new Date('2026-04-27T10:00:00Z'),
  }
}

describe('/api/u/[slug]/kb-github-remote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    auditEventMock.mockResolvedValue(undefined)
    findIntegrationMock.mockResolvedValue(null)
    decryptIntegrationConfigMock.mockReturnValue(null)
    saveIntegrationConfigMock.mockResolvedValue(makeRecord())
    clearIntegrationMock.mockResolvedValue(makeRecord())
  })

  describe('GET', () => {
    it('returns integration payload for admins', async () => {
      findIntegrationMock.mockResolvedValue(makeRecord({
        version: 2,
        updatedAt: new Date('2026-04-27T11:00:00Z'),
      }))
      decryptIntegrationConfigMock.mockReturnValue({
        repoUrl: 'https://github.com/owner/repo.git',
        pat: 'ghp_abc',
      })

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({
        repoUrl: 'https://github.com/owner/repo.git',
        configured: true,
        hasPat: true,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastError: null,
        remoteBranch: null,
        version: 2,
        updatedAt: '2026-04-27T11:00:00.000Z',
      })
    })

    it('never exposes the PAT value', async () => {
      findIntegrationMock.mockResolvedValue(makeRecord())
      decryptIntegrationConfigMock.mockReturnValue({
        repoUrl: 'https://github.com/owner/repo.git',
        pat: 'ghp_secret_token_value',
      })

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      const body = await response.json()
      const bodyStr = JSON.stringify(body)
      expect(bodyStr).not.toContain('ghp_secret_token_value')
      expect(body.hasPat).toBe(true)
    })

    it('returns 403 for non-admin users', async () => {
      authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(403)
    })
  })

  describe('PUT', () => {
    it('saves new credentials', async () => {
      decryptIntegrationConfigMock.mockReturnValue({
        repoUrl: 'https://github.com/owner/repo.git',
        pat: 'ghp_abc',
      })

      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({
            repoUrl: 'https://github.com/owner/repo.git',
            pat: 'ghp_new',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
        repoUrl: 'https://github.com/owner/repo.git',
        pat: 'ghp_new',
      })
      expect(auditEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kb_github_remote.updated',
        }),
      )
    })

    it('rejects missing repo URL', async () => {
      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({ pat: 'ghp_abc' }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'missing_repo_url' })
    })

    it('rejects non-HTTPS repo URL', async () => {
      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({
            repoUrl: 'git@github.com:owner/repo.git',
            pat: 'ghp_abc',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'invalid_repo_url' })
    })

    it('rejects missing PAT on first save', async () => {
      findIntegrationMock.mockResolvedValue(null)
      decryptIntegrationConfigMock.mockReturnValue(null)

      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({ repoUrl: 'https://github.com/owner/repo.git' }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'missing_pat' })
    })

    it('allows blank PAT when existing PAT is saved', async () => {
      findIntegrationMock.mockResolvedValue(makeRecord())
      decryptIntegrationConfigMock.mockReturnValue({
        repoUrl: 'https://github.com/old/repo.git',
        pat: 'ghp_existing',
      })

      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({ repoUrl: 'https://github.com/new/repo.git' }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
        repoUrl: 'https://github.com/new/repo.git',
        pat: null,
      })
    })
  })

  describe('DELETE', () => {
    it('clears integration', async () => {
      const { DELETE } = await import('../route')
      const response = await DELETE(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          method: 'DELETE',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      expect(clearIntegrationMock).toHaveBeenCalled()
      expect(auditEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kb_github_remote.deleted',
        }),
      )
    })
  })
})
