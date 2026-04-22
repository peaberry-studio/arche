import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuditEvent = vi.fn()
const mockDecryptConfig = vi.fn()
const mockGetRuntimeCapabilities = vi.fn()
const mockGetSession = vi.fn()
const mockGetPublicBaseUrl = vi.fn()
const mockIsDesktop = vi.fn(() => false)
const mockPrepareConnectorOAuthAuthorization = vi.fn()
const mockValidateDesktopToken = vi.fn(() => true)
const mockValidateSameOrigin = vi.fn(() => ({ ok: true }))
const mockFindByIdAndUserIdSelect = vi.fn()
const mockFindIdBySlug = vi.fn()

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
  }))

  vi.doMock('@/lib/connectors/oauth', async () => {
    const actual = await vi.importActual<typeof import('@/lib/connectors/oauth')>('@/lib/connectors/oauth')

    return {
      ...actual,
      prepareConnectorOAuthAuthorization: (...args: unknown[]) => mockPrepareConnectorOAuthAuthorization(...args),
    }
  })

  vi.doMock('@/lib/csrf', () => ({
    validateSameOrigin: () => mockValidateSameOrigin(),
  }))

  vi.doMock('@/lib/http', () => ({
    getPublicBaseUrl: () => mockGetPublicBaseUrl(),
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
      findByIdAndUserIdSelect: (...args: unknown[]) => mockFindByIdAndUserIdSelect(...args),
    },
    userService: {
      findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
    },
  }))

  return import('@/app/api/u/[slug]/connectors/[id]/oauth/start/route')
}

describe('POST /api/u/[slug]/connectors/[id]/oauth/start', () => {
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
    mockGetPublicBaseUrl.mockReturnValue('https://arche.example.com')
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockFindByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'linear',
      config: 'encrypted-config',
    })
    mockDecryptConfig.mockReturnValue({
      authType: 'oauth',
      oauthActor: 'app',
      oauthClientId: 'linear-client-id',
      oauthClientSecret: 'linear-client-secret',
    })
    mockPrepareConnectorOAuthAuthorization.mockResolvedValue({
      authorizeUrl: 'https://linear.app/oauth/authorize?actor=app',
      state: 'state-token',
    })
    mockAuditEvent.mockResolvedValue(undefined)
  })

  it('decrypts Linear connector config before preparing app actor OAuth', async () => {
    const { POST } = await loadRoute()
    const request = {
      headers: new Headers({ host: 'localhost', origin: 'http://localhost' }),
      nextUrl: new URL('http://localhost/api/u/alice/connectors/conn-1/oauth/start?returnTo=/u/alice/settings/integrations/slack'),
    }

    const response = await POST(request as never, {
      params: Promise.resolve({ slug: 'alice', id: 'conn-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      authorizeUrl: 'https://linear.app/oauth/authorize?actor=app',
    })

    expect(mockDecryptConfig).toHaveBeenCalledWith('encrypted-config')
    expect(mockPrepareConnectorOAuthAuthorization).toHaveBeenCalledWith({
      connectorId: 'conn-1',
      slug: 'alice',
      returnTo: '/u/alice/settings/integrations/slack',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        authType: 'oauth',
        oauthActor: 'app',
        oauthClientId: 'linear-client-id',
        oauthClientSecret: 'linear-client-secret',
      },
    })
  })

  it('returns 400 when Linear app actor credentials are missing', async () => {
    mockDecryptConfig.mockReturnValue({ authType: 'oauth', oauthActor: 'app' })
    mockPrepareConnectorOAuthAuthorization.mockRejectedValue(new Error('missing_linear_oauth_client_credentials'))

    const { POST } = await loadRoute()
    const request = {
      headers: new Headers({ host: 'localhost', origin: 'http://localhost' }),
      nextUrl: new URL('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
    }

    const response = await POST(request as never, {
      params: Promise.resolve({ slug: 'alice', id: 'conn-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'missing_linear_oauth_client_credentials',
    })
  })
})
