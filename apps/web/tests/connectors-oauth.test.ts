import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildConfigWithOAuth, getConnectorAuthType, getConnectorOAuthConfig, isOAuthTokenExpiringSoon } from '@/lib/connectors/oauth-config'
import {
  issueConnectorOAuthState,
  prepareConnectorOAuthAuthorization,
  refreshConnectorOAuthToken,
  verifyConnectorOAuthState,
} from '@/lib/connectors/oauth'
import { validateConnectorConfig } from '@/lib/connectors/validators'

const mockValidateConnectorTestEndpoint = vi.hoisted(() => vi.fn())

vi.mock('@/lib/security/ssrf', () => ({
  validateConnectorTestEndpoint: (...args: unknown[]) => mockValidateConnectorTestEndpoint(...args),
}))

const originalOAuthMaxAuthorizeUrlLength = process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH

describe('connectors oauth state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockValidateConnectorTestEndpoint.mockImplementation(async (rawEndpoint: string) => ({
      ok: true,
      url: new URL(rawEndpoint),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalOAuthMaxAuthorizeUrlLength === undefined) {
      delete process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH
      return
    }

    process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH = originalOAuthMaxAuthorizeUrlLength
  })

  it('issues and verifies state token', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn1',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'linear',
    })

    const payload = verifyConnectorOAuthState(state)
    expect(payload.connectorId).toBe('conn1')
    expect(payload.slug).toBe('alice')
    expect(payload.userId).toBe('user1')
    expect(payload.connectorType).toBe('linear')
  })

  it('round-trips custom OAuth state fields', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn-custom',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'custom',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      codeVerifier: 'code-verifier',
      clientId: 'custom-client-id',
      clientSecret: 'custom-client-secret',
      tokenEndpoint: 'https://oauth.example.com/token',
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      registrationEndpoint: 'https://oauth.example.com/register',
      issuer: 'https://oauth.example.com',
      mcpServerUrl: 'https://mcp.example.com/mcp',
    })

    const payload = verifyConnectorOAuthState(state)
    expect(payload).toMatchObject({
      connectorId: 'conn-custom',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'custom',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      codeVerifier: 'code-verifier',
      clientId: 'custom-client-id',
      clientSecret: 'custom-client-secret',
      tokenEndpoint: 'https://oauth.example.com/token',
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      registrationEndpoint: 'https://oauth.example.com/register',
      issuer: 'https://oauth.example.com',
      mcpServerUrl: 'https://mcp.example.com/mcp',
    })
  })

  it('rejects tampered state token', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn1',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'notion',
    })

    const [encoded] = state.split('.')
    expect(() => verifyConnectorOAuthState(`${encoded}.tampered`)).toThrow('invalid_state')
  })

  it('rejects oversized OAuth authorization URLs', async () => {
    process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH = '300'

    const longSegment = 'a'.repeat(220)
    await expect(
      prepareConnectorOAuthAuthorization({
        connectorId: 'conn-custom',
        slug: 'alice',
        userId: 'user1',
        connectorType: 'custom',
        redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
        connectorConfig: {
          endpoint: 'https://mcp.example.com/mcp',
          oauthClientId: 'client-id',
          oauthClientSecret: 'client-secret',
          oauthAuthorizationEndpoint: `https://oauth.example.com/${longSegment}/authorize`,
          oauthTokenEndpoint: `https://oauth.example.com/${longSegment}/token`,
        },
      })
    ).rejects.toThrow('oauth_state_too_large')
  })

  it('uses discovered fallback metadata and dynamic registration for custom OAuth', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ client_id: 'registered-client', client_secret: 'registered-secret' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        )
    )

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-custom',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'custom',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        endpoint: 'https://mcp.custom.example.com/mcp',
      },
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.origin).toBe('https://mcp.custom.example.com')
    expect(authorizeUrl.pathname).toBe('/authorize')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('registered-client')

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.authorizationEndpoint).toBe('https://mcp.custom.example.com/authorize')
    expect(state.tokenEndpoint).toBe('https://mcp.custom.example.com/token')
    expect(state.registrationEndpoint).toBe('https://mcp.custom.example.com/register')
  })

  it('falls back to static custom OAuth client when dynamic registration fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('registration error', { status: 500 }))
    )

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-custom',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'custom',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        endpoint: 'https://mcp.custom.example.com/mcp',
        oauthClientId: 'static-client-id',
        oauthClientSecret: 'static-client-secret',
        oauthAuthorizationEndpoint: 'https://oauth.custom.example.com/authorize',
        oauthTokenEndpoint: 'https://oauth.custom.example.com/token',
        oauthRegistrationEndpoint: 'https://oauth.custom.example.com/register',
      },
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('static-client-id')

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.clientId).toBe('static-client-id')
    expect(state.clientSecret).toBe('static-client-secret')
  })

  it('refreshes custom OAuth token using explicit token endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        token_type: 'Bearer',
        scope: 'read write',
        expires_in: 3600,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await refreshConnectorOAuthToken({
      connectorType: 'custom',
      refreshToken: 'refresh-token',
      clientId: 'custom-client-id',
      clientSecret: 'custom-client-secret',
      tokenEndpoint: 'https://oauth.example.com/token',
    })

    expect(result.accessToken).toBe('new-access-token')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth.example.com/token',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('discovers token endpoint during custom OAuth refresh when missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          authorization_endpoint: 'https://oauth.example.com/authorize',
          token_endpoint: 'https://oauth.example.com/token',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 1200 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const result = await refreshConnectorOAuthToken({
      connectorType: 'custom',
      refreshToken: 'refresh-token',
      clientId: 'custom-client-id',
      mcpServerUrl: 'https://mcp.example.com/mcp',
    })

    expect(result.accessToken).toBe('refreshed-token')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://mcp.example.com/.well-known/oauth-authorization-server',
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://oauth.example.com/token',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('connectors oauth config', () => {
  it('validates oauth mode without manual required fields', () => {
    expect(validateConnectorConfig('notion', { authType: 'oauth' })).toEqual({ valid: true })
    expect(validateConnectorConfig('linear', { authType: 'oauth' })).toEqual({ valid: true })
    expect(validateConnectorConfig('custom', { authType: 'oauth', endpoint: 'https://api.example.com/mcp' })).toEqual({
      valid: true,
    })
    expect(validateConnectorConfig('custom', { authType: 'oauth' })).toEqual({
      valid: false,
      missing: ['endpoint'],
    })
  })

  it('builds and parses oauth config', () => {
    const config = buildConfigWithOAuth({
      connectorType: 'linear',
      currentConfig: { org: 'acme' },
      oauth: {
        clientId: 'client-123',
        accessToken: 'token123',
        refreshToken: 'refresh123',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    })

    expect(getConnectorAuthType(config)).toBe('oauth')
    const oauth = getConnectorOAuthConfig('linear', config)
    expect(oauth?.clientId).toBe('client-123')
    expect(oauth?.accessToken).toBe('token123')
    expect(oauth?.refreshToken).toBe('refresh123')

    const customConfig = buildConfigWithOAuth({
      connectorType: 'custom',
      currentConfig: { endpoint: 'https://api.example.com/mcp' },
      oauth: {
        clientId: 'custom-client',
        accessToken: 'custom-token',
      },
    })
    const customOauth = getConnectorOAuthConfig('custom', customConfig)
    expect(customOauth?.provider).toBe('custom')
    expect(customOauth?.accessToken).toBe('custom-token')
  })

  it('detects token expiring soon', () => {
    const soon = new Date(Date.now() + 30_000).toISOString()
    const later = new Date(Date.now() + 600_000).toISOString()

    expect(
      isOAuthTokenExpiringSoon({
        provider: 'linear',
        clientId: 'client-123',
        accessToken: 'token',
        expiresAt: soon,
        connectedAt: new Date().toISOString(),
      })
    ).toBe(true)

    expect(
      isOAuthTokenExpiringSoon({
        provider: 'notion',
        clientId: 'client-123',
        accessToken: 'token',
        expiresAt: later,
        connectedAt: new Date().toISOString(),
      })
    ).toBe(false)
  })
})
