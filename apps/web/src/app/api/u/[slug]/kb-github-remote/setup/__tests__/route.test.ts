import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveIntegrationConfigMock = vi.fn()
const exchangeManifestCodeMock = vi.fn()
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
    saveIntegrationConfig: (...args: unknown[]) => saveIntegrationConfigMock(...args),
  },
}))

vi.mock('@/lib/git/github-app-auth', () => ({
  exchangeManifestCode: (...args: unknown[]) => exchangeManifestCodeMock(...args),
}))

describe('/api/u/[slug]/kb-github-remote/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    auditEventMock.mockResolvedValue(undefined)
    saveIntegrationConfigMock.mockResolvedValue({
      singletonKey: 'kb_github_remote',
      config: 'enc:test',
      state: {},
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    exchangeManifestCodeMock.mockResolvedValue({
      ok: true,
      appId: 12345,
      slug: 'arche-kb-sync',
      pem: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
      clientId: 'Iv1.abc123',
      webhookSecret: 'wh_secret',
      owner: 'my-org',
    })
  })

  it('exchanges code and stores credentials on success', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/setup?code=test_code_123') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toContain('/u/alice/settings/integrations/kb-github-remote')
    expect(location).toContain('app_created=true')

    expect(exchangeManifestCodeMock).toHaveBeenCalledWith('test_code_123')
    expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
      appId: '12345',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
      appSlug: 'arche-kb-sync',
    })
    expect(auditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'kb_github_remote.app_created',
        metadata: expect.objectContaining({ appId: 12345, appSlug: 'arche-kb-sync', owner: 'my-org' }),
      }),
    )
  })

  it('redirects with error when code is missing', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/setup') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=missing_code')
  })

  it('redirects with error when exchange fails', async () => {
    exchangeManifestCodeMock.mockResolvedValue({
      ok: false,
      message: 'Invalid or expired manifest code',
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/setup?code=expired_code') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=exchange_failed')
    expect(saveIntegrationConfigMock).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin users', async () => {
    authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/setup?code=test_code') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(403)
  })
})
