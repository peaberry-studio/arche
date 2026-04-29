import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()

const authState = {
  user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
}

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
  },
}))

function makeRecord() {
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
    },
    version: 1,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    updatedAt: new Date('2026-04-27T10:00:00Z'),
  }
}

describe('/api/u/[slug]/kb-github-remote/install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    findIntegrationMock.mockResolvedValue(makeRecord())
    decryptIntegrationConfigMock.mockReturnValue({
      appId: '12345',
      privateKey: 'pem-data',
      appSlug: 'my-app',
    })
  })

  it('redirects to GitHub app installation page', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/install') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://github.com/apps/my-app/installations/new')
  })

  it('URL-encodes the app slug', async () => {
    decryptIntegrationConfigMock.mockReturnValue({
      appId: '12345',
      privateKey: 'pem-data',
      appSlug: 'my app with spaces',
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/install') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://github.com/apps/my%20app%20with%20spaces/installations/new')
  })

  it('returns 400 when not configured', async () => {
    findIntegrationMock.mockResolvedValue(null)

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/install') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'not_configured' })
  })

  it('returns 400 when app slug is missing', async () => {
    decryptIntegrationConfigMock.mockReturnValue({
      appId: '12345',
      privateKey: 'pem-data',
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/install') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'missing_app_slug' })
  })

  it('returns 403 for non-admin users', async () => {
    authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/install') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(403)
  })
})
