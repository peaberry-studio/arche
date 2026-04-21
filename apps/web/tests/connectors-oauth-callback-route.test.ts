import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockVerifyConnectorOAuthState = vi.fn()
const mockExchangeConnectorOAuthCode = vi.fn()
const mockFindByIdAndUserIdSelect = vi.fn()
const mockUpdateByIdUnsafe = vi.fn()
const mockAuditEvent = vi.fn()
const mockDecryptConfig = vi.fn()
const mockEncryptConfig = vi.fn()
const mockBuildConfigWithOAuth = vi.fn()

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role },
    sessionId: 'session-1',
  }
}

async function loadRoute() {
  vi.doMock('@/lib/runtime/session', () => ({
    getSession: () => mockGetSession(),
  }))

  vi.doMock('@/lib/runtime/desktop/current-vault', () => ({
    getCurrentDesktopVault: () => null,
    getDesktopWorkspaceHref: () => '/desktop/connectors',
  }))

  vi.doMock('@/lib/http', () => ({
    getPublicBaseUrl: () => 'https://arche.example.com',
  }))

  vi.doMock('@/lib/auth', () => ({
    auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
  }))

  vi.doMock('@/lib/services', () => ({
    connectorService: {
      findByIdAndUserIdSelect: (...args: unknown[]) => mockFindByIdAndUserIdSelect(...args),
      updateByIdUnsafe: (...args: unknown[]) => mockUpdateByIdUnsafe(...args),
    },
  }))

  vi.doMock('@/lib/connectors/oauth', async () => {
    const actual = await vi.importActual<typeof import('@/lib/connectors/oauth')>('@/lib/connectors/oauth')

    return {
      ...actual,
      exchangeConnectorOAuthCode: (...args: unknown[]) => mockExchangeConnectorOAuthCode(...args),
      isOAuthConnectorType: () => true,
      verifyConnectorOAuthState: (...args: unknown[]) => mockVerifyConnectorOAuthState(...args),
    }
  })

  vi.doMock('@/lib/connectors/crypto', () => ({
    decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
    encryptConfig: (...args: unknown[]) => mockEncryptConfig(...args),
  }))

  vi.doMock('@/lib/connectors/oauth-config', () => ({
    buildConfigWithOAuth: (...args: unknown[]) => mockBuildConfigWithOAuth(...args),
  }))

  vi.doMock('@/lib/connectors/validators', () => ({
    validateConnectorType: () => true,
  }))

  return import('@/app/api/connectors/oauth/callback/route')
}

describe('GET /api/connectors/oauth/callback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockFindByIdAndUserIdSelect.mockResolvedValue({
      id: 'custom-1',
      type: 'custom',
      config: 'encrypted-config',
    })
    mockDecryptConfig.mockReturnValue({ endpoint: 'https://mcp.example.com/mcp' })
    mockExchangeConnectorOAuthCode.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: '2026-04-21T10:00:00.000Z',
    })
    mockBuildConfigWithOAuth.mockReturnValue({ authType: 'oauth' })
    mockEncryptConfig.mockReturnValue('next-config')
    mockUpdateByIdUnsafe.mockResolvedValue(undefined)
    mockAuditEvent.mockResolvedValue(undefined)
  })

  it('redirects back to a safe embedded return path after success', async () => {
    mockGetSession.mockResolvedValue(session('alice', 'ADMIN'))
    mockVerifyConnectorOAuthState.mockReturnValue({
      connectorId: 'custom-1',
      slug: 'slack-bot',
      returnTo: '/u/alice/settings/integrations/slack',
      userId: 'service-1',
      connectorType: 'custom',
      clientId: 'client-id',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://oauth.example.com/token',
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      registrationEndpoint: 'https://oauth.example.com/register',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
    })

    const { GET } = await loadRoute()
    const response = await GET({
      headers: new Headers(),
      nextUrl: new URL('https://arche.example.com/api/connectors/oauth/callback?code=oauth-code&state=token'),
    } as never)

    expect(response.headers.get('location')).toBe(
      'https://arche.example.com/u/alice/settings/integrations/slack?oauth=success'
    )
  })

  it('falls back to the workspace connectors page for unsafe return paths', async () => {
    mockGetSession.mockResolvedValue(session('alice', 'ADMIN'))
    mockVerifyConnectorOAuthState.mockReturnValue({
      connectorId: 'custom-1',
      slug: 'slack-bot',
      returnTo: '/\\evil.example.com',
      userId: 'service-1',
      connectorType: 'custom',
      clientId: 'client-id',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://oauth.example.com/token',
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      registrationEndpoint: 'https://oauth.example.com/register',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
    })

    const { GET } = await loadRoute()
    const response = await GET({
      headers: new Headers(),
      nextUrl: new URL('https://arche.example.com/api/connectors/oauth/callback?code=oauth-code&state=token'),
    } as never)

    expect(response.headers.get('location')).toBe(
      'https://arche.example.com/u/slack-bot/connectors?oauth=success'
    )
  })

  it('keeps a safe embedded return path on connector lookup errors', async () => {
    mockGetSession.mockResolvedValue(session('alice', 'ADMIN'))
    mockFindByIdAndUserIdSelect.mockResolvedValue(null)
    mockVerifyConnectorOAuthState.mockReturnValue({
      connectorId: 'custom-1',
      slug: 'slack-bot',
      returnTo: '/u/alice/settings/integrations/slack',
      userId: 'service-1',
      connectorType: 'custom',
      clientId: 'client-id',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://oauth.example.com/token',
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      registrationEndpoint: 'https://oauth.example.com/register',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
    })

    const { GET } = await loadRoute()
    const response = await GET({
      headers: new Headers(),
      nextUrl: new URL('https://arche.example.com/api/connectors/oauth/callback?code=oauth-code&state=token'),
    } as never)

    expect(response.headers.get('location')).toBe(
      'https://arche.example.com/u/alice/settings/integrations/slack?oauth=error&message=connector_not_found'
    )
  })
})
