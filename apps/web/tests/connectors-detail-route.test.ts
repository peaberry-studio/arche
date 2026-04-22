import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuditEvent = vi.fn()
const mockDecryptConfig = vi.fn()
const mockEncryptConfig = vi.fn()
const mockGetRuntimeCapabilities = vi.fn()
const mockGetSession = vi.fn()
const mockIsDesktop = vi.fn(() => false)
const mockValidateDesktopToken = vi.fn(() => true)
const mockFindByIdAndUserId = vi.fn()
const mockFindById = vi.fn()
const mockFindIdBySlug = vi.fn()
const mockUpdateManyByIdAndUserId = vi.fn()

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role },
    sessionId: 'session-1',
  }
}

async function loadRoute() {
  vi.doMock('@/lib/auth', () => ({
    auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
  }))

  vi.doMock('@/lib/connectors/crypto', () => ({
    decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
    encryptConfig: (...args: unknown[]) => mockEncryptConfig(...args),
  }))

  vi.doMock('@/lib/runtime/capabilities', () => ({
    getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
  }))

  vi.doMock('@/lib/runtime/desktop/token', () => ({
    DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
    validateDesktopToken: () => mockValidateDesktopToken(),
  }))

  vi.doMock('@/lib/runtime/mode', () => ({
    isDesktop: () => mockIsDesktop(),
  }))

  vi.doMock('@/lib/runtime/session', () => ({
    getSession: () => mockGetSession(),
  }))

  vi.doMock('@/lib/services', () => ({
    connectorService: {
      findById: (...args: unknown[]) => mockFindById(...args),
      findByIdAndUserId: (...args: unknown[]) => mockFindByIdAndUserId(...args),
      updateManyByIdAndUserId: (...args: unknown[]) => mockUpdateManyByIdAndUserId(...args),
    },
    userService: {
      findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
    },
  }))

  return import('@/app/api/u/[slug]/connectors/[id]/route')
}

describe('GET /api/u/[slug]/connectors/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: true,
      auth: true,
      containers: true,
      workspaceAgent: true,
      reaper: true,
      connectors: true,
      csrf: true,
      teamManagement: true,
      kickstart: true,
      autopilot: true,
      slackIntegration: true,
      twoFactor: false,
    })
    mockGetSession.mockResolvedValue(session('alice'))
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockFindByIdAndUserId.mockResolvedValue({
      id: 'linear-app',
      userId: 'user-1',
      type: 'linear',
      name: 'Linear',
      config: 'encrypted-config',
      enabled: true,
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      updatedAt: new Date('2026-04-21T10:05:00.000Z'),
    })
    mockDecryptConfig.mockReturnValue({
      authType: 'oauth',
      oauthActor: 'app',
      oauthClientId: 'linear-client-id',
      oauthClientSecret: 'linear-client-secret',
      oauth: {
        provider: 'linear',
        accessToken: 'linear-token',
        clientId: 'client-1',
        clientSecret: 'linear-secret',
        tokenEndpoint: 'https://api.linear.app/oauth/token',
        connectedAt: '2026-04-21T09:59:00.000Z',
      },
    })
  })

  it('returns Linear OAuth actor mode and hides stored client secrets from the edit payload', async () => {
    const { GET } = await loadRoute()
    const response = await GET(new Request('http://localhost/api/u/alice/connectors/linear-app') as never, {
      params: Promise.resolve({ slug: 'alice', id: 'linear-app' }),
    })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.oauthActor).toBe('app')
    expect(body.config).toEqual({
      authType: 'oauth',
      oauthActor: 'app',
      oauthClientId: 'linear-client-id',
      oauth: {
        provider: 'linear',
        connected: true,
        expiresAt: undefined,
        connectedAt: '2026-04-21T09:59:00.000Z',
        scope: undefined,
      },
    })
  })

  it('preserves Linear app actor mode when patching with the config returned by GET', async () => {
    mockFindById.mockResolvedValue({
      id: 'linear-app',
      type: 'linear',
      name: 'Linear',
      enabled: true,
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      updatedAt: new Date('2026-04-21T10:06:00.000Z'),
    })
    mockUpdateManyByIdAndUserId.mockResolvedValue({ count: 1 })
    mockEncryptConfig.mockReturnValue('encrypted-updated-config')

    const { PATCH } = await loadRoute()
    const response = await PATCH(new Request('http://localhost/api/u/alice/connectors/linear-app', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        host: 'localhost',
        origin: 'http://localhost',
      },
      body: JSON.stringify({
        config: {
          authType: 'oauth',
          oauthActor: 'app',
          oauthClientId: 'linear-client-id',
          oauth: {
            provider: 'linear',
            connected: true,
            connectedAt: '2026-04-21T09:59:00.000Z',
          },
        },
      }),
    }) as never, {
      params: Promise.resolve({ slug: 'alice', id: 'linear-app' }),
    })

    expect(response.status).toBe(200)
    expect(mockEncryptConfig).toHaveBeenCalledWith({
      authType: 'oauth',
      oauthActor: 'app',
      oauthClientId: 'linear-client-id',
      oauthClientSecret: 'linear-client-secret',
      oauth: {
        provider: 'linear',
        connected: true,
        accessToken: 'linear-token',
        clientId: 'client-1',
        clientSecret: 'linear-secret',
        connectedAt: '2026-04-21T09:59:00.000Z',
        tokenEndpoint: 'https://api.linear.app/oauth/token',
      },
    })

    await expect(response.json()).resolves.toEqual({
      id: 'linear-app',
      type: 'linear',
      name: 'Linear',
        config: {
          authType: 'oauth',
          oauthActor: 'app',
          oauthClientId: 'linear-client-id',
          oauth: {
            provider: 'linear',
            connected: true,
          connectedAt: '2026-04-21T09:59:00.000Z',
        },
      },
      enabled: true,
      authType: 'oauth',
      oauthActor: 'app',
      oauthConnected: true,
      oauthExpiresAt: undefined,
      createdAt: '2026-04-21T10:00:00.000Z',
      updatedAt: '2026-04-21T10:06:00.000Z',
    })
  })
})
