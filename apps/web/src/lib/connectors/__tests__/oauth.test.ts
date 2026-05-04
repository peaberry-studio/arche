import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/connectors/oauth-metadata', () => ({
  discoverOAuthMetadata: vi.fn(),
  getString: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined),
  sanitizeOAuthMetadata: vi.fn(),
}))

vi.mock('@/lib/connectors/oauth-provider-strategies', () => ({
  getStrategy: vi.fn(),
}))

vi.mock('@/lib/connectors/google-workspace', () => ({
  isGoogleWorkspaceConnectorType: vi.fn().mockReturnValue(false),
}))

import { discoverOAuthMetadata, sanitizeOAuthMetadata } from '@/lib/connectors/oauth-metadata'
import { getStrategy } from '@/lib/connectors/oauth-provider-strategies'
import { isGoogleWorkspaceConnectorType } from '@/lib/connectors/google-workspace'
import {
  exchangeConnectorOAuthCode,
  isOAuthConnectorType,
  issueConnectorOAuthState,
  normalizeConnectorOAuthReturnTo,
  prepareConnectorOAuthAuthorization,
  refreshConnectorOAuthToken,
  verifyConnectorOAuthState,
} from '@/lib/connectors/oauth'

describe('isOAuthConnectorType', () => {
  it('returns true for oauth connector types', () => {
    expect(isOAuthConnectorType('linear')).toBe(true)
    expect(isOAuthConnectorType('meta-ads')).toBe(true)
    expect(isOAuthConnectorType('google_gmail')).toBe(true)
  })

  it('returns false for non-oauth connector types', () => {
    expect(isOAuthConnectorType('zendesk')).toBe(false)
    expect(isOAuthConnectorType('ahrefs')).toBe(false)
  })
})

describe('normalizeConnectorOAuthReturnTo', () => {
  it('returns undefined for null or empty values', () => {
    expect(normalizeConnectorOAuthReturnTo(null)).toBeUndefined()
    expect(normalizeConnectorOAuthReturnTo(undefined)).toBeUndefined()
    expect(normalizeConnectorOAuthReturnTo('')).toBeUndefined()
  })

  it('returns pathname for local paths', () => {
    expect(normalizeConnectorOAuthReturnTo('/settings/connectors')).toBe('/settings/connectors')
  })

  it('strips origin from localhost URLs', () => {
    expect(normalizeConnectorOAuthReturnTo('http://localhost/settings')).toBe('/settings')
    expect(normalizeConnectorOAuthReturnTo('http://localhost/')).toBe('/')
  })

  it('returns undefined for non-localhost origins', () => {
    expect(normalizeConnectorOAuthReturnTo('http://evil.com/settings')).toBeUndefined()
    expect(normalizeConnectorOAuthReturnTo('https://example.com/path')).toBeUndefined()
  })
})

describe('issueConnectorOAuthState / verifyConnectorOAuthState', () => {
  beforeEach(() => {
    delete process.env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET
    delete process.env.ARCHE_CONNECTOR_OAUTH_STATE_TTL_SECONDS
  })

  it('round-trips a valid state payload', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
    })

    const payload = verifyConnectorOAuthState(state)
    expect(payload.connectorId).toBe('conn-1')
    expect(payload.slug).toBe('workspace-1')
    expect(payload.userId).toBe('user-1')
    expect(payload.connectorType).toBe('linear')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('round-trips optional fields', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'http://localhost/callback',
      codeVerifier: 'verifier-123',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      tokenEndpoint: 'https://example.com/token',
      authorizationEndpoint: 'https://example.com/authorize',
    })

    const payload = verifyConnectorOAuthState(state)
    expect(payload.redirectUri).toBe('http://localhost/callback')
    expect(payload.codeVerifier).toBe('verifier-123')
    expect(payload.clientId).toBe('client-1')
    expect(payload.clientSecret).toBe('secret-1')
    expect(payload.tokenEndpoint).toBe('https://example.com/token')
    expect(payload.authorizationEndpoint).toBe('https://example.com/authorize')
  })

  it('throws invalid_state for malformed tokens', () => {
    expect(() => verifyConnectorOAuthState('not-valid')).toThrow('invalid_state')
    expect(() => verifyConnectorOAuthState('a.b')).toThrow('invalid_state')
    expect(() => verifyConnectorOAuthState('a.b.c.d')).toThrow('invalid_state')
  })

  it('throws invalid_state for tampered tokens', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
    })

    // Tamper with the payload portion (middle segment) to corrupt the ciphertext
    const parts = state.split('.')
    const flipped = parts[1][0] === 'A' ? 'B' : 'A'
    const tampered = [parts[0], flipped + parts[1].slice(1), parts[2]].join('.')
    expect(() => verifyConnectorOAuthState(tampered)).toThrow('invalid_state')
  })

  it('throws expired_state when state expires', async () => {
    process.env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET = 'test-secret-for-oauth'
    process.env.ARCHE_CONNECTOR_OAUTH_STATE_TTL_SECONDS = '1'

    const state = issueConnectorOAuthState({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
    })

    // Wait for the state to expire
    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(() => verifyConnectorOAuthState(state)).toThrow('expired_state')

    delete process.env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET
    delete process.env.ARCHE_CONNECTOR_OAUTH_STATE_TTL_SECONDS
  })
})

describe('prepareConnectorOAuthAuthorization', () => {
  const linearStrategy = {
    getMcpServerUrl: vi.fn().mockResolvedValue('https://mcp.example.com'),
    getScope: vi.fn().mockReturnValue('read write'),
    getStaticClientRegistration: vi.fn().mockReturnValue(null),
    preferStaticClientRegistration: vi.fn().mockReturnValue(false),
    getMetadataOverrides: vi.fn().mockResolvedValue({}),
    shouldValidateMetadataEndpoints: vi.fn().mockReturnValue(true),
    decorateAuthorizeUrl: vi.fn(),
    usesPkce: vi.fn().mockReturnValue(true),
    resolveTokenEndpoint: vi.fn().mockResolvedValue('https://example.com/token'),
    resolveRefreshTokenEndpoint: vi.fn().mockResolvedValue('https://example.com/refresh'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getStrategy).mockReturnValue(linearStrategy as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prepares authorization URL with discovered metadata and dynamic registration', async () => {
    vi.mocked(discoverOAuthMetadata).mockResolvedValue({
      issuer: 'https://example.com',
      authorizationEndpoint: 'https://example.com/authorize',
      tokenEndpoint: 'https://example.com/token',
      registrationEndpoint: 'https://example.com/register',
    })
    vi.mocked(sanitizeOAuthMetadata).mockResolvedValue({
      issuer: 'https://example.com',
      authorizationEndpoint: 'https://example.com/authorize',
      tokenEndpoint: 'https://example.com/token',
      registrationEndpoint: 'https://example.com/register',
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ client_id: 'dyn-client-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'http://localhost/callback',
    })

    expect(result.authorizeUrl).toContain('https://example.com/authorize')
    expect(result.authorizeUrl).toContain('client_id=dyn-client-1')
    expect(result.authorizeUrl).toContain('response_type=code')
    expect(result.authorizeUrl).toContain('redirect_uri=http%3A%2F%2Flocalhost%2Fcallback')
    expect(result.authorizeUrl).toContain('code_challenge=')
    expect(result.authorizeUrl).toContain('code_challenge_method=S256')
    expect(result.state).toBeDefined()
  })

  it('prepares authorization URL with manual endpoints and static client', async () => {
    const manualStrategy = {
      ...linearStrategy,
      getStaticClientRegistration: vi.fn().mockReturnValue({ clientId: 'static-client' }),
      preferStaticClientRegistration: vi.fn().mockReturnValue(true),
      getMetadataOverrides: vi.fn().mockResolvedValue({
        authorizationEndpoint: 'https://example.com/authorize',
        tokenEndpoint: 'https://example.com/token',
      }),
      shouldValidateMetadataEndpoints: vi.fn().mockReturnValue(false),
    }
    vi.mocked(getStrategy).mockReturnValue(manualStrategy as never)

    const result = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'http://localhost/callback',
    })

    expect(result.authorizeUrl).toContain('client_id=static-client')
    expect(result.authorizeUrl).toContain('code_challenge=')
    expect(result.authorizeUrl).toContain('code_challenge_method=S256')
    expect(discoverOAuthMetadata).not.toHaveBeenCalled()
  })

  it('throws when dynamic registration is required but no registration endpoint exists', async () => {
    vi.mocked(discoverOAuthMetadata).mockResolvedValue({
      issuer: 'https://example.com',
      authorizationEndpoint: 'https://example.com/authorize',
      tokenEndpoint: 'https://example.com/token',
    })
    vi.mocked(sanitizeOAuthMetadata).mockResolvedValue({
      issuer: 'https://example.com',
      authorizationEndpoint: 'https://example.com/authorize',
      tokenEndpoint: 'https://example.com/token',
    })

    await expect(
      prepareConnectorOAuthAuthorization({
        connectorId: 'conn-1',
        slug: 'workspace-1',
        userId: 'user-1',
        connectorType: 'linear',
        redirectUri: 'http://localhost/callback',
      })
    ).rejects.toThrow('oauth_registration_failed:missing_registration_endpoint')
  })

  it('falls back to static registration when dynamic registration returns no client id', async () => {
    const fallbackStrategy = {
      ...linearStrategy,
      getStaticClientRegistration: vi.fn().mockReturnValue({ clientId: 'static-client' }),
      preferStaticClientRegistration: vi.fn().mockReturnValue(false),
    }
    vi.mocked(getStrategy).mockReturnValue(fallbackStrategy as never)
    vi.mocked(discoverOAuthMetadata).mockResolvedValue({
      issuer: 'https://example.com',
      authorizationEndpoint: 'https://example.com/authorize',
      tokenEndpoint: 'https://example.com/token',
      registrationEndpoint: 'https://example.com/register',
    })
    vi.mocked(sanitizeOAuthMetadata).mockResolvedValue({
      issuer: 'https://example.com',
      authorizationEndpoint: 'https://example.com/authorize',
      tokenEndpoint: 'https://example.com/token',
      registrationEndpoint: 'https://example.com/register',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }))

    const result = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'http://localhost/callback',
    })

    expect(result.authorizeUrl).toContain('client_id=static-client')
  })

  it('omits PKCE challenge fields for non-PKCE strategies', async () => {
    const nonPkceStrategy = {
      ...linearStrategy,
      getStaticClientRegistration: vi.fn().mockReturnValue({ clientId: 'static-client' }),
      preferStaticClientRegistration: vi.fn().mockReturnValue(true),
      getMetadataOverrides: vi.fn().mockResolvedValue({
        authorizationEndpoint: 'https://example.com/authorize',
        tokenEndpoint: 'https://example.com/token',
      }),
      shouldValidateMetadataEndpoints: vi.fn().mockReturnValue(false),
      usesPkce: vi.fn().mockReturnValue(false),
    }
    vi.mocked(getStrategy).mockReturnValue(nonPkceStrategy as never)

    const result = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-1',
      slug: 'workspace-1',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'http://localhost/callback',
    })

    const authorizeUrl = new URL(result.authorizeUrl)
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeNull()
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBeNull()
    expect(verifyConnectorOAuthState(result.state).codeVerifier).toBeUndefined()
  })

  it('throws meta_ads_missing_app_id for meta-ads without credentials', async () => {
    const metaStrategy = {
      ...linearStrategy,
      getStaticClientRegistration: vi.fn().mockReturnValue(null),
    }
    vi.mocked(getStrategy).mockReturnValue(metaStrategy as never)

    await expect(
      prepareConnectorOAuthAuthorization({
        connectorId: 'conn-meta',
        slug: 'workspace-1',
        userId: 'user-1',
        connectorType: 'meta-ads',
        redirectUri: 'http://localhost/callback',
      })
    ).rejects.toThrow('meta_ads_missing_app_id')
  })

  it('throws meta_ads_missing_app_secret for meta-ads without secret', async () => {
    const metaStrategy = {
      ...linearStrategy,
      getStaticClientRegistration: vi.fn().mockReturnValue({ clientId: 'app-id' }),
    }
    vi.mocked(getStrategy).mockReturnValue(metaStrategy as never)

    await expect(
      prepareConnectorOAuthAuthorization({
        connectorId: 'conn-meta',
        slug: 'workspace-1',
        userId: 'user-1',
        connectorType: 'meta-ads',
        redirectUri: 'http://localhost/callback',
      })
    ).rejects.toThrow('meta_ads_missing_app_secret')
  })

  it('throws oauth_state_too_large when authorize URL exceeds max length', async () => {
    const hugeStrategy = {
      ...linearStrategy,
      getMetadataOverrides: vi.fn().mockResolvedValue({
        authorizationEndpoint: 'https://example.com/authorize',
        tokenEndpoint: 'https://example.com/token',
      }),
      shouldValidateMetadataEndpoints: vi.fn().mockReturnValue(false),
      preferStaticClientRegistration: vi.fn().mockReturnValue(true),
      getStaticClientRegistration: vi.fn().mockReturnValue({ clientId: 'a'.repeat(2000) }),
    }
    vi.mocked(getStrategy).mockReturnValue(hugeStrategy as never)
    process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH = '100'

    await expect(
      prepareConnectorOAuthAuthorization({
        connectorId: 'conn-1',
        slug: 'workspace-1',
        userId: 'user-1',
        connectorType: 'linear',
        redirectUri: 'http://localhost/callback',
      })
    ).rejects.toThrow('oauth_state_too_large')

    delete process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH
  })
})

describe('exchangeConnectorOAuthCode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exchanges code with standard PKCE flow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-123',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const strategy = {
      resolveTokenEndpoint: vi.fn().mockResolvedValue('https://example.com/token'),
      resolveRefreshTokenEndpoint: vi.fn(),
    }
    vi.mocked(getStrategy).mockReturnValue(strategy as never)

    const result = await exchangeConnectorOAuthCode({
      code: 'code-123',
      redirectUri: 'http://localhost/callback',
      state: {
        connectorType: 'linear',
        clientId: 'client-1',
        codeVerifier: 'verifier',
        tokenEndpoint: 'https://example.com/token',
      } as never,
    })

    expect(result.accessToken).toBe('access-123')
    expect(result.refreshToken).toBe('refresh-123')
    expect(result.tokenType).toBe('Bearer')
    expect(result.expiresAt).toBeDefined()
  })

  it('exchanges code for meta-ads long-lived token', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'short-lived',
        expires_in: 3600,
      }),
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'long-lived',
        expires_in: 5184000,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const strategy = {
      resolveTokenEndpoint: vi.fn(),
      resolveRefreshTokenEndpoint: vi.fn(),
    }
    vi.mocked(getStrategy).mockReturnValue(strategy as never)

    const result = await exchangeConnectorOAuthCode({
      code: 'code-123',
      redirectUri: 'http://localhost/callback',
      state: {
        connectorType: 'meta-ads',
        clientId: 'app-id',
        clientSecret: 'app-secret',
        tokenEndpoint: 'https://graph.facebook.com/token',
      } as never,
    })

    expect(result.accessToken).toBe('long-lived')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws a detailed exchange error when the token endpoint returns OAuth errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 'invalid_grant', error_description: 'Bad code' }),
    }))
    vi.mocked(getStrategy).mockReturnValue({
      resolveTokenEndpoint: vi.fn().mockResolvedValue('https://example.com/token'),
      resolveRefreshTokenEndpoint: vi.fn(),
    } as never)

    await expect(
      exchangeConnectorOAuthCode({
        code: 'code-123',
        redirectUri: 'http://localhost/callback',
        state: {
          connectorType: 'linear',
          clientId: 'client-1',
          codeVerifier: 'verifier',
          tokenEndpoint: 'https://example.com/token',
        } as never,
      })
    ).rejects.toThrow('oauth_exchange_failed:invalid_grant:Bad code')
  })

  it('throws when a successful token response is missing access_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ refresh_token: 'refresh-only' }),
    }))
    vi.mocked(getStrategy).mockReturnValue({
      resolveTokenEndpoint: vi.fn().mockResolvedValue('https://example.com/token'),
      resolveRefreshTokenEndpoint: vi.fn(),
    } as never)

    await expect(
      exchangeConnectorOAuthCode({
        code: 'code-123',
        redirectUri: 'http://localhost/callback',
        state: {
          connectorType: 'linear',
          clientId: 'client-1',
          codeVerifier: 'verifier',
          tokenEndpoint: 'https://example.com/token',
        } as never,
      })
    ).rejects.toThrow('oauth_missing_access_token')
  })

  it('throws invalid_state when meta-ads state lacks required fields', async () => {
    await expect(
      exchangeConnectorOAuthCode({
        code: 'code-123',
        redirectUri: 'http://localhost/callback',
        state: {
          connectorType: 'meta-ads',
          clientId: undefined,
          clientSecret: 'secret',
          tokenEndpoint: 'https://graph.facebook.com/token',
        } as never,
      })
    ).rejects.toThrow('invalid_state')
  })

  it('throws invalid_state when standard state lacks codeVerifier', async () => {
    await expect(
      exchangeConnectorOAuthCode({
        code: 'code-123',
        redirectUri: 'http://localhost/callback',
        state: {
          connectorType: 'linear',
          clientId: 'client-1',
          codeVerifier: undefined,
          tokenEndpoint: 'https://example.com/token',
        } as never,
      })
    ).rejects.toThrow('invalid_state')
  })
})

describe('refreshConnectorOAuthToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes token successfully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const strategy = {
      resolveRefreshTokenEndpoint: vi.fn().mockResolvedValue('https://example.com/refresh'),
      resolveTokenEndpoint: vi.fn(),
    }
    vi.mocked(getStrategy).mockReturnValue(strategy as never)

    const result = await refreshConnectorOAuthToken({
      connectorType: 'linear',
      refreshToken: 'old-refresh',
      clientId: 'client-1',
    })

    expect(result.accessToken).toBe('new-access')
    expect(result.refreshToken).toBe('new-refresh')
    expect(result.expiresAt).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('includes clientSecret when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-with-secret' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const strategy = {
      resolveRefreshTokenEndpoint: vi.fn().mockResolvedValue('https://example.com/refresh'),
      resolveTokenEndpoint: vi.fn(),
    }
    vi.mocked(getStrategy).mockReturnValue(strategy as never)

    await refreshConnectorOAuthToken({
      connectorType: 'linear',
      refreshToken: 'old-refresh',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    })

    const body = (fetchMock.mock.calls[0][1] as { body: string }).body
    expect(body).toContain('client_secret=secret-1')
  })
})
