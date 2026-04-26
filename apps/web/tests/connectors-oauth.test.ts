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
const originalNotionClientId = process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID
const originalNotionClientSecret = process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET
const originalNotionMcpUrl = process.env.ARCHE_CONNECTOR_NOTION_MCP_URL
const originalLinearMcpUrl = process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL
const originalGoogleClientId = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
const originalGoogleClientSecret = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
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
    } else {
      process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH = originalOAuthMaxAuthorizeUrlLength
    }
    if (originalNotionClientId === undefined) {
      delete process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID
    } else {
      process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID = originalNotionClientId
    }
    if (originalNotionClientSecret === undefined) {
      delete process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET
    } else {
      process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET = originalNotionClientSecret
    }
    if (originalNotionMcpUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_NOTION_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_NOTION_MCP_URL = originalNotionMcpUrl
    }
    if (originalLinearMcpUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL = originalLinearMcpUrl
    }
    if (originalGoogleClientId === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = originalGoogleClientId
    }
    if (originalGoogleClientSecret === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = originalGoogleClientSecret
    }
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
      returnTo: '/u/alice/settings/integrations/slack',
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
      returnTo: '/u/alice/settings/integrations/slack',
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

  it('propagates an optional returnTo path through prepared OAuth state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('registration error', { status: 500 }))
    )

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-custom',
      slug: 'alice',
      returnTo: '/u/alice/settings/integrations/slack',
      userId: 'user1',
      connectorType: 'custom',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        endpoint: 'https://mcp.custom.example.com/mcp',
        oauthClientId: 'static-client-id',
        oauthAuthorizationEndpoint: 'https://oauth.custom.example.com/authorize',
        oauthTokenEndpoint: 'https://oauth.custom.example.com/token',
      },
    })

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.returnTo).toBe('/u/alice/settings/integrations/slack')
  })

  it('adds actor=app only for Linear app actor OAuth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          authorization_endpoint: 'https://mcp.linear.app/authorize',
          token_endpoint: 'https://mcp.linear.app/token',
          registration_endpoint: 'https://mcp.linear.app/register',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: 'dynamic-user-client' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const userPrepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'linear-user',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: { authType: 'oauth', oauthScope: 'read,write' },
    })

    const appPrepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'linear-app',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        authType: 'oauth',
        oauthActor: 'app',
        oauthClientId: 'linear-app-client-id',
        oauthClientSecret: 'linear-app-client-secret',
        oauthScope: 'read,write,app:mentionable',
      },
    })

    const userAuthorizeUrl = new URL(userPrepared.authorizeUrl)
    const appAuthorizeUrl = new URL(appPrepared.authorizeUrl)

    expect(`${userAuthorizeUrl.origin}${userAuthorizeUrl.pathname}`).toBe('https://mcp.linear.app/authorize')
    expect(`${appAuthorizeUrl.origin}${appAuthorizeUrl.pathname}`).toBe('https://linear.app/oauth/authorize')
    expect(userAuthorizeUrl.searchParams.get('scope')).toBe('read,write')
    expect(appAuthorizeUrl.searchParams.get('scope')).toBe('read,write,app:mentionable')
    expect(userAuthorizeUrl.searchParams.get('actor')).toBeNull()
    expect(appAuthorizeUrl.searchParams.get('actor')).toBe('app')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mcp.linear.app/.well-known/oauth-authorization-server')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://mcp.linear.app/register')
  })

  it('requires Linear app actor client credentials', async () => {
    await expect(prepareConnectorOAuthAuthorization({
      connectorId: 'linear-app',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        authType: 'oauth',
        oauthActor: 'app',
      },
    })).rejects.toThrow('missing_linear_oauth_client_credentials')
  })

  it('uses Linear app actor client credentials from connector config before dynamic registration', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'linear-app',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        authType: 'oauth',
        oauthActor: 'app',
        oauthClientId: 'connector-client-id',
        oauthClientSecret: 'connector-client-secret',
      },
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('connector-client-id')
    expect(authorizeUrl.searchParams.get('actor')).toBe('app')

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.clientId).toBe('connector-client-id')
    expect(state.clientSecret).toBe('connector-client-secret')
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('discovers Linear user OAuth metadata via fallback when well-known is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: 'linear-user-dynamic' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'linear-user',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'linear',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: { authType: 'oauth' },
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.origin).toBe('https://mcp.linear.app')
    expect(authorizeUrl.pathname).toBe('/authorize')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('linear-user-dynamic')
    expect(authorizeUrl.searchParams.get('actor')).toBeNull()

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.clientId).toBe('linear-user-dynamic')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mcp.linear.app/.well-known/oauth-authorization-server')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://mcp.linear.app/register')
  })

  it('uses Notion static env credentials when registration endpoint is unavailable', async () => {
    process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID = 'notion-env-client-id'
    process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET = 'notion-env-client-secret'

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        authorization_endpoint: 'https://mcp.notion.com/authorize',
        token_endpoint: 'https://mcp.notion.com/token',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'notion-1',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'notion',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('notion-env-client-id')

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.clientId).toBe('notion-env-client-id')
    expect(state.clientSecret).toBe('notion-env-client-secret')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to dynamic registration for Notion when env credentials are missing', async () => {
    delete process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID
    delete process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: 'notion-dynamic-client' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'notion-1',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'notion',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.origin).toBe('https://mcp.notion.com')
    expect(authorizeUrl.pathname).toBe('/authorize')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('notion-dynamic-client')

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.clientId).toBe('notion-dynamic-client')
  })

  it('requires Google static OAuth credentials', async () => {
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET

    await expect(
      prepareConnectorOAuthAuthorization({
        connectorId: 'gmail-1',
        slug: 'alice',
        userId: 'user-1',
        connectorType: 'google_gmail',
        redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      })
    ).rejects.toThrow('missing_google_oauth_client_credentials')
  })

  it('uses Google credentials from connector config over env when provided', async () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-client-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-client-secret'

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'gmail-1',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'google_gmail',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        clientId: 'dashboard-client-id',
        clientSecret: 'dashboard-client-secret',
      },
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('dashboard-client-id')

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.clientId).toBe('dashboard-client-id')
    expect(state.clientSecret).toBe('dashboard-client-secret')
  })

  it('prepares Google OAuth with official endpoints, scopes, and offline access', async () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'google-client-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'google-client-secret'

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'gmail-1',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'google_gmail',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('google-client-id')
    expect(authorizeUrl.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose'
    )
    expect(authorizeUrl.searchParams.get('access_type')).toBe('offline')
    expect(authorizeUrl.searchParams.get('prompt')).toBe('consent')

    const state = verifyConnectorOAuthState(prepared.state)
    expect(state.clientId).toBe('google-client-id')
    expect(state.clientSecret).toBe('google-client-secret')
    expect(state.tokenEndpoint).toBe('https://oauth2.googleapis.com/token')
    expect(state.mcpServerUrl).toBe('https://gmailmcp.googleapis.com/mcp/v1')
  })

  it('discovers token endpoint during Linear OAuth refresh when missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          authorization_endpoint: 'https://mcp.linear.app/authorize',
          token_endpoint: 'https://mcp.linear.app/token',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'linear-refreshed-token', expires_in: 1200 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const result = await refreshConnectorOAuthToken({
      connectorType: 'linear',
      refreshToken: 'refresh-token',
      clientId: 'linear-client-id',
    })

    expect(result.accessToken).toBe('linear-refreshed-token')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://mcp.linear.app/.well-known/oauth-authorization-server',
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://mcp.linear.app/token',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('discovers token endpoint during Notion OAuth refresh when missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          authorization_endpoint: 'https://mcp.notion.com/authorize',
          token_endpoint: 'https://mcp.notion.com/token',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'notion-refreshed-token', expires_in: 1200 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const result = await refreshConnectorOAuthToken({
      connectorType: 'notion',
      refreshToken: 'refresh-token',
      clientId: 'notion-client-id',
    })

    expect(result.accessToken).toBe('notion-refreshed-token')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://mcp.notion.com/.well-known/oauth-authorization-server',
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://mcp.notion.com/token',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('prepares Meta Ads OAuth without PKCE using connector credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: 'conn-meta',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'meta-ads',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      connectorConfig: {
        authType: 'oauth',
        appId: 'meta-app-id',
        appSecret: 'meta-app-secret',
      },
    })

    const authorizeUrl = new URL(prepared.authorizeUrl)
    expect(authorizeUrl.origin).toBe('https://www.facebook.com')
    expect(authorizeUrl.pathname).toContain('/dialog/oauth')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('meta-app-id')
    expect(authorizeUrl.searchParams.get('scope')).toBe('ads_read')
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exchanges Meta Ads code into a long-lived token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-lived-token', token_type: 'bearer' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-lived-token', expires_in: 5183944 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const state = verifyConnectorOAuthState(issueConnectorOAuthState({
      connectorId: 'conn-meta',
      slug: 'alice',
      userId: 'user-1',
      connectorType: 'meta-ads',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      clientId: 'meta-app-id',
      clientSecret: 'meta-app-secret',
      tokenEndpoint: 'https://graph.facebook.com/v25.0/oauth/access_token',
      authorizationEndpoint: 'https://www.facebook.com/v25.0/dialog/oauth',
    }))

    const result = await (await import('@/lib/connectors/oauth')).exchangeConnectorOAuthCode({
      code: 'oauth-code',
      redirectUri: 'https://arche.example.com/api/connectors/oauth/callback',
      state,
    })

    expect(result.accessToken).toBe('long-lived-token')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('code=oauth-code'),
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('fb_exchange_token=short-lived-token'),
      expect.objectContaining({ method: 'GET' })
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
      currentConfig: { org: 'acme', oauthActor: 'app' },
      oauth: {
        clientId: 'client-123',
        accessToken: 'token123',
        refreshToken: 'refresh123',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    })

    expect(getConnectorAuthType(config)).toBe('oauth')
    expect(config.oauthActor).toBe('app')
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
