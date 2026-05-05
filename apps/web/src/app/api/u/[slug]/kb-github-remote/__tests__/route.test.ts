import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const clearIntegrationMock = vi.fn()
const toSummaryMock = vi.fn()
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
    clearIntegration: (...args: unknown[]) => clearIntegrationMock(...args),
    toSummary: (...args: unknown[]) => toSummaryMock(...args),
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
    clearIntegrationMock.mockResolvedValue(makeRecord())
    toSummaryMock.mockImplementation((record: ReturnType<typeof makeRecord> | null, config: Record<string, unknown> | null) => {
      const state = record?.state
      return {
        appId: config?.appId ?? null,
        appSlug: config?.appSlug ?? null,
        appConfigured: Boolean(config?.appId && config?.privateKey),
        hasPrivateKey: Boolean(config?.privateKey),
        installationId: state?.installationId ?? null,
        repoFullName: state?.repoFullName ?? null,
        ready: Boolean(config?.appId && config?.privateKey && state?.installationId && state?.repoCloneUrl),
        lastSyncAt: state?.lastSyncAt ?? null,
        lastSyncStatus: state?.lastSyncStatus ?? null,
        lastError: state?.lastError ?? null,
        remoteBranch: state?.remoteBranch ?? null,
        version: record?.version ?? 0,
        updatedAt: record?.updatedAt?.toISOString() ?? null,
      }
    })
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
