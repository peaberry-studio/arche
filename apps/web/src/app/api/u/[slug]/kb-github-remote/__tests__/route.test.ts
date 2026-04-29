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
      installationId: null,
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
        state: { installationId: 99, repoFullName: 'owner/repo', repoCloneUrl: 'https://github.com/owner/repo.git' },
      }))
      decryptIntegrationConfigMock.mockReturnValue({
        appId: '12345',
        privateKey: 'pem-data',
        appSlug: 'my-app',
      })

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({
        appId: '12345',
        appSlug: 'my-app',
        appConfigured: true,
        hasPrivateKey: true,
        installationId: 99,
        repoFullName: 'owner/repo',
        ready: true,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastError: null,
        remoteBranch: null,
        version: 2,
        updatedAt: '2026-04-27T11:00:00.000Z',
      })
    })

    it('never exposes the private key value', async () => {
      findIntegrationMock.mockResolvedValue(makeRecord())
      decryptIntegrationConfigMock.mockReturnValue({
        appId: '12345',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----',
        appSlug: 'my-app',
      })

      const { GET } = await import('../route')
      const response = await GET(
        new Request('http://localhost/api/u/alice/kb-github-remote') as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      const body = await response.json()
      const bodyStr = JSON.stringify(body)
      expect(bodyStr).not.toContain('BEGIN RSA PRIVATE KEY')
      expect(body.hasPrivateKey).toBe(true)
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
    it('saves new app credentials', async () => {
      decryptIntegrationConfigMock.mockReturnValue({
        appId: '12345',
        privateKey: 'pem-data',
        appSlug: 'my-app',
      })

      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({
            appId: '12345',
            privateKey: 'new-pem',
            appSlug: 'my-app',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
        appId: '12345',
        privateKey: 'new-pem',
        appSlug: 'my-app',
      })
      expect(auditEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kb_github_remote.updated',
        }),
      )
    })

    it('rejects missing app ID', async () => {
      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({ privateKey: 'pem-data' }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'missing_app_id' })
    })

    it('rejects missing private key on first save', async () => {
      findIntegrationMock.mockResolvedValue(null)
      decryptIntegrationConfigMock.mockReturnValue(null)

      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({ appId: '12345' }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'missing_private_key' })
    })

    it('allows blank private key when existing key is saved', async () => {
      findIntegrationMock.mockResolvedValue(makeRecord())
      decryptIntegrationConfigMock.mockReturnValue({
        appId: '12345',
        privateKey: 'existing-pem',
        appSlug: 'my-app',
      })

      const { PUT } = await import('../route')
      const response = await PUT(
        new Request('http://localhost/api/u/alice/kb-github-remote', {
          body: JSON.stringify({ appId: '12345', appSlug: 'new-slug' }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }) as never,
        { params: Promise.resolve({ slug: 'alice' }) },
      )

      expect(response.status).toBe(200)
      expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
        appId: '12345',
        privateKey: null,
        appSlug: 'new-slug',
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
