import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const ensureIntegrationSeededFromEnvMock = vi.fn()
const getResolvedCredentialsMock = vi.fn()
const saveIntegrationConfigMock = vi.fn()
const clearIntegrationMock = vi.fn()
const auditEventMock = vi.fn()
const requireCapabilityMock = vi.fn()

const authState = {
  user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
}

vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => auditEventMock(...args),
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
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
  googleWorkspaceService: {
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    decryptIntegrationConfig: (...args: unknown[]) => decryptIntegrationConfigMock(...args),
    ensureIntegrationSeededFromEnv: (...args: unknown[]) => ensureIntegrationSeededFromEnvMock(...args),
    getResolvedCredentials: (...args: unknown[]) => getResolvedCredentialsMock(...args),
    saveIntegrationConfig: (...args: unknown[]) => saveIntegrationConfigMock(...args),
    clearIntegration: (...args: unknown[]) => clearIntegrationMock(...args),
  },
}))

describe('/api/u/[slug]/google-workspace-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    requireCapabilityMock.mockReturnValue(null)
    auditEventMock.mockResolvedValue(undefined)
    findIntegrationMock.mockResolvedValue(null)
    decryptIntegrationConfigMock.mockReturnValue(null)
    ensureIntegrationSeededFromEnvMock.mockResolvedValue(null)
    getResolvedCredentialsMock.mockResolvedValue(null)
    saveIntegrationConfigMock.mockResolvedValue({
      singletonKey: 'default',
      config: 'enc:{"clientId":"saved-id","clientSecret":"saved-secret"}',
      version: 2,
      createdAt: new Date('2026-04-25T10:00:00Z'),
      updatedAt: new Date('2026-04-25T10:00:00Z'),
    })
    clearIntegrationMock.mockResolvedValue({
      singletonKey: 'default',
      config: 'enc:{}',
      version: 3,
      createdAt: new Date('2026-04-25T10:00:00Z'),
      updatedAt: new Date('2026-04-25T10:00:00Z'),
    })

    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
  })

  it('returns integration payload for admins with persisted config', async () => {
    ensureIntegrationSeededFromEnvMock.mockResolvedValue({
      singletonKey: 'default',
      config: 'enc:test',
      version: 2,
      createdAt: new Date('2026-04-25T10:00:00Z'),
      updatedAt: new Date('2026-04-25T11:00:00Z'),
    })
    decryptIntegrationConfigMock.mockReturnValue({ clientId: 'test-id', clientSecret: 'test-secret' })

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/u/alice/google-workspace-integration') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      clientId: 'test-id',
      configured: true,
      hasClientSecret: true,
      version: 2,
      updatedAt: '2026-04-25T11:00:00.000Z',
    })
  })

  it('returns seeded env credentials with persisted metadata when no row existed', async () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-secret'

    ensureIntegrationSeededFromEnvMock.mockResolvedValue({
      singletonKey: 'default',
      config: 'enc:{"clientId":"env-id","clientSecret":"env-secret"}',
      version: 1,
      createdAt: new Date('2026-04-25T10:00:00Z'),
      updatedAt: new Date('2026-04-25T10:00:00Z'),
    })
    decryptIntegrationConfigMock.mockReturnValue({ clientId: 'env-id', clientSecret: 'env-secret' })

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/u/alice/google-workspace-integration') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      clientId: 'env-id',
      configured: true,
      hasClientSecret: true,
      version: 1,
      updatedAt: '2026-04-25T10:00:00.000Z',
    })
  })

  it('returns null values for explicitly cleared config', async () => {
    ensureIntegrationSeededFromEnvMock.mockResolvedValue({
      singletonKey: 'default',
      config: 'enc:{}',
      version: 1,
      createdAt: new Date('2026-04-25T10:00:00Z'),
      updatedAt: new Date('2026-04-25T10:00:00Z'),
    })
    decryptIntegrationConfigMock.mockReturnValue({})

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/u/alice/google-workspace-integration') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      clientId: null,
      configured: false,
      hasClientSecret: false,
      version: 1,
      updatedAt: '2026-04-25T10:00:00.000Z',
    })
  })

  it('saves new credentials', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        body: JSON.stringify({ clientId: 'new-id', clientSecret: 'new-secret' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
      clientId: 'new-id',
      clientSecret: 'new-secret',
    })
    expect(auditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'google_workspace_integration.updated',
      })
    )
  })

  it('rejects missing client id', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        body: JSON.stringify({ clientSecret: 'new-secret' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'missing_client_id' })
  })

  it('rejects missing client secret on first save', async () => {
    findIntegrationMock.mockResolvedValue(null)
    decryptIntegrationConfigMock.mockReturnValue(null)

    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        body: JSON.stringify({ clientId: 'new-id' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'missing_client_secret' })
  })

  it('allows blank secret when existing secret is saved', async () => {
    findIntegrationMock.mockResolvedValue({
      singletonKey: 'default',
      config: 'enc:test',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    decryptIntegrationConfigMock.mockReturnValue({ clientId: 'old-id', clientSecret: 'old-secret' })

    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        body: JSON.stringify({ clientId: 'new-id' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
      clientId: 'new-id',
      clientSecret: null,
    })
  })

  it('rejects invalid JSON on PUT', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        body: 'bad json',
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
  })

  it('rejects non-object bodies on PUT', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        body: JSON.stringify([]),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' })
  })

  it('rethrows unexpected JSON parsing errors on PUT', async () => {
    const { PUT } = await import('./route')
    const request = new Request('http://localhost/api/u/alice/google-workspace-integration', {
      body: JSON.stringify({ clientId: 'id', clientSecret: 'secret' }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    Object.defineProperty(request, 'json', {
      value: vi.fn().mockRejectedValue(new TypeError('stream failed')),
    })

    await expect(
      PUT(request as never, { params: Promise.resolve({ slug: 'alice' }) })
    ).rejects.toThrow('stream failed')
  })

  it('clears integration on DELETE', async () => {
    const { DELETE } = await import('./route')
    const response = await DELETE(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        method: 'DELETE',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    expect(clearIntegrationMock).toHaveBeenCalled()
    expect(auditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'google_workspace_integration.deleted',
      })
    )
  })

  it('rejects non-admin users', async () => {
    authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/u/alice/google-workspace-integration') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(403)
  })

  it('returns capability denial before admin checks', async () => {
    requireCapabilityMock.mockReturnValue(new Response(JSON.stringify({ error: 'disabled' }), { status: 404 }))

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/u/alice/google-workspace-integration') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'disabled' })
  })

  it('rejects non-admin users for PUT and DELETE', async () => {
    authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }
    const { DELETE, PUT } = await import('./route')

    const putResponse = await PUT(
      new Request('http://localhost/api/u/alice/google-workspace-integration', {
        body: JSON.stringify({ clientId: 'id', clientSecret: 'secret' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )
    const deleteResponse = await DELETE(
      new Request('http://localhost/api/u/alice/google-workspace-integration', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(putResponse.status).toBe(403)
    expect(deleteResponse.status).toBe(403)
  })
})
