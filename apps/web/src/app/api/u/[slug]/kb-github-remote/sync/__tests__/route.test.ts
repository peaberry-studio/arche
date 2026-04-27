import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const updateSyncStateMock = vi.fn()
const pushToGithubMock = vi.fn()
const pullFromGithubMock = vi.fn()
const getSyncStateMock = vi.fn()
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
    getSyncState: (...args: unknown[]) => getSyncStateMock(...args),
  },
}))

vi.mock('@/lib/git/kb-github-sync', () => ({
  pushToGithub: (...args: unknown[]) => pushToGithubMock(...args),
  pullFromGithub: (...args: unknown[]) => pullFromGithubMock(...args),
}))

function makeRecord() {
  return {
    singletonKey: 'kb_github_remote',
    config: 'enc:test',
    state: { lastSyncAt: null, lastSyncStatus: null, lastError: null, remoteBranch: null, lastPushAt: null, lastPullAt: null },
    version: 1,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    updatedAt: new Date('2026-04-27T10:00:00Z'),
  }
}

describe('/api/u/[slug]/kb-github-remote/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    auditEventMock.mockResolvedValue(undefined)
    updateSyncStateMock.mockResolvedValue(undefined)
    findIntegrationMock.mockResolvedValue(makeRecord())
    decryptIntegrationConfigMock.mockReturnValue({
      repoUrl: 'https://github.com/owner/repo.git',
      pat: 'ghp_abc',
    })
    getSyncStateMock.mockResolvedValue({
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      remoteBranch: null,
      lastPushAt: null,
      lastPullAt: null,
    })
  })

  describe('POST', () => {
    it('pushes to GitHub successfully', async () => {
      pushToGithubMock.mockResolvedValue({
        ok: true,
        status: 'pushed',
        commitHash: 'abc123',
      })

      const { POST } = await import('../route')
      const response = await POST(
        new Request('http://localhost/api/u/alice/kb-github-remote/sync', {
          body: JSON.stringify({ direction: 'push' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ ok: true, status: 'pushed' })
      expect(pushToGithubMock).toHaveBeenCalledWith(
        'https://github.com/owner/repo.git',
        'ghp_abc',
      )
      expect(updateSyncStateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lastSyncStatus: 'success',
          lastError: null,
          lastPushAt: expect.any(String),
        }),
      )
      expect(auditEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kb_github_remote.push',
        }),
      )
    })

    it('pulls from GitHub successfully', async () => {
      pullFromGithubMock.mockResolvedValue({
        ok: true,
        status: 'pulled',
        commitHash: 'def456',
      })

      const { POST } = await import('../route')
      const response = await POST(
        new Request('http://localhost/api/u/alice/kb-github-remote/sync', {
          body: JSON.stringify({ direction: 'pull' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ ok: true, status: 'pulled' })
      expect(pullFromGithubMock).toHaveBeenCalled()
      expect(updateSyncStateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lastPullAt: expect.any(String),
        }),
      )
    })

    it('rejects invalid direction', async () => {
      const { POST } = await import('../route')
      const response = await POST(
        new Request('http://localhost/api/u/alice/kb-github-remote/sync', {
          body: JSON.stringify({ direction: 'sideways' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'invalid_direction' })
    })

    it('returns 400 when not configured', async () => {
      findIntegrationMock.mockResolvedValue(null)

      const { POST } = await import('../route')
      const response = await POST(
        new Request('http://localhost/api/u/alice/kb-github-remote/sync', {
          body: JSON.stringify({ direction: 'push' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
    })

    it('records error state on push failure', async () => {
      pushToGithubMock.mockResolvedValue({
        ok: false,
        status: 'auth_failed',
        message: 'Authentication failed',
      })

      const { POST } = await import('../route')
      await POST(
        new Request('http://localhost/api/u/alice/kb-github-remote/sync', {
          body: JSON.stringify({ direction: 'push' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(updateSyncStateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lastSyncStatus: 'error',
          lastError: 'Authentication failed',
        }),
      )
    })
  })

  describe('GET', () => {
    it('returns sync state', async () => {
      getSyncStateMock.mockResolvedValue({
        lastSyncAt: '2026-04-27T09:00:00Z',
        lastSyncStatus: 'success',
        lastError: null,
        remoteBranch: 'main',
        lastPushAt: '2026-04-27T09:00:00Z',
        lastPullAt: null,
      })

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote/sync') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.lastSyncStatus).toBe('success')
      expect(body.remoteBranch).toBe('main')
    })

    it('returns 403 for non-admin users', async () => {
      authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote/sync') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(403)
    })
  })
})
