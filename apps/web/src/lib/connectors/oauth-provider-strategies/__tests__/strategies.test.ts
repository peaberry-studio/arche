import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { customStrategy } from '@/lib/connectors/oauth-provider-strategies/custom'
import { getStrategy } from '@/lib/connectors/oauth-provider-strategies'
import { linearStrategy } from '@/lib/connectors/oauth-provider-strategies/linear'
import { metaAdsStrategy } from '@/lib/connectors/oauth-provider-strategies/meta-ads'
import { notionStrategy } from '@/lib/connectors/oauth-provider-strategies/notion'

const discoverOAuthMetadataMock = vi.hoisted(() => vi.fn())
const sanitizeOAuthMetadataMock = vi.hoisted(() => vi.fn())
const validateConnectorUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/connectors/oauth-metadata', () => ({
  discoverOAuthMetadata: (...args: unknown[]) => discoverOAuthMetadataMock(...args),
  getString: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined),
  sanitizeOAuthMetadata: (...args: unknown[]) => sanitizeOAuthMetadataMock(...args),
  validateConnectorUrl: (...args: unknown[]) => validateConnectorUrlMock(...args),
}))

const originalEnv = {
  ARCHE_CONNECTOR_LINEAR_MCP_URL: process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL,
  ARCHE_CONNECTOR_LINEAR_SCOPE: process.env.ARCHE_CONNECTOR_LINEAR_SCOPE,
  ARCHE_CONNECTOR_NOTION_CLIENT_ID: process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID,
  ARCHE_CONNECTOR_NOTION_CLIENT_SECRET: process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET,
  ARCHE_CONNECTOR_NOTION_MCP_URL: process.env.ARCHE_CONNECTOR_NOTION_MCP_URL,
  ARCHE_CONNECTOR_NOTION_SCOPE: process.env.ARCHE_CONNECTOR_NOTION_SCOPE,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('OAuth provider strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreEnv()
    validateConnectorUrlMock.mockImplementation(async (url: string) => url.trim())
    sanitizeOAuthMetadataMock.mockImplementation(async (metadata: unknown) => metadata)
    discoverOAuthMetadataMock.mockResolvedValue({ tokenEndpoint: 'https://auth.example.com/token' })
  })

  afterEach(() => {
    restoreEnv()
  })

  it('resolves custom connector metadata and refresh endpoints', async () => {
    await expect(customStrategy.getMcpServerUrl()).rejects.toThrow('missing_endpoint')
    await expect(customStrategy.getMcpServerUrl({ endpoint: ' https://mcp.example.com ' })).resolves.toBe('https://mcp.example.com')
    expect(customStrategy.getScope({ oauthScope: ' read write ' })).toBe('read write')
    expect(customStrategy.getStaticClientRegistration({
      oauthClientId: ' client-id ',
      oauthClientSecret: ' client-secret ',
    })).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    expect(customStrategy.getStaticClientRegistration({})).toBeNull()
    await expect(customStrategy.getMetadataOverrides({
      oauthAuthorizationEndpoint: ' https://auth.example.com/authorize ',
      oauthRegistrationEndpoint: ' https://auth.example.com/register ',
      oauthTokenEndpoint: ' https://auth.example.com/token ',
    })).resolves.toEqual({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      registrationEndpoint: 'https://auth.example.com/register',
      tokenEndpoint: 'https://auth.example.com/token',
    })
    expect(customStrategy.shouldValidateMetadataEndpoints()).toBe(true)
    expect(customStrategy.usesPkce()).toBe(true)
    await expect(customStrategy.resolveTokenEndpoint(' https://auth.example.com/token ')).resolves.toBe('https://auth.example.com/token')
    await expect(customStrategy.resolveRefreshTokenEndpoint({ tokenEndpoint: ' https://auth.example.com/token ' })).resolves.toBe('https://auth.example.com/token')
    await expect(customStrategy.resolveRefreshTokenEndpoint({})).rejects.toThrow('oauth_refresh_failed:missing_mcp_server_url')
    await expect(customStrategy.resolveRefreshTokenEndpoint({ mcpServerUrl: ' https://mcp.example.com ' })).resolves.toBe('https://auth.example.com/token')
  })

  it('resolves Linear user and app actor settings', async () => {
    process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL = 'https://linear.example.com/mcp'
    process.env.ARCHE_CONNECTOR_LINEAR_SCOPE = 'read,issues:create'

    await expect(linearStrategy.getMcpServerUrl()).resolves.toBe('https://linear.example.com/mcp')
    expect(linearStrategy.getScope()).toBe('read,issues:create')
    expect(linearStrategy.getScope({ oauthScope: ' custom-scope ' })).toBe('custom-scope')
    expect(linearStrategy.getStaticClientRegistration({ oauthActor: 'user' })).toBeNull()
    expect(linearStrategy.getStaticClientRegistration({
      oauthActor: 'app',
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
    })).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    expect(linearStrategy.preferStaticClientRegistration({ oauthActor: 'app' })).toBe(true)
    await expect(linearStrategy.getMetadataOverrides({ oauthActor: 'app' })).resolves.toEqual({
      authorizationEndpoint: 'https://linear.app/oauth/authorize',
      tokenEndpoint: 'https://api.linear.app/oauth/token',
    })

    const url = new URL('https://linear.app/oauth/authorize')
    linearStrategy.decorateAuthorizeUrl(url, { oauthActor: 'app' })
    expect(url.searchParams.get('actor')).toBe('app')
    await expect(linearStrategy.resolveRefreshTokenEndpoint({})).resolves.toBe('https://auth.example.com/token')
  })

  it('resolves Meta Ads static OAuth settings', async () => {
    expect(metaAdsStrategy.getScope({ oauthScope: ' custom ' })).toBe('custom')
    expect(metaAdsStrategy.getStaticClientRegistration({ appId: ' app-id ', appSecret: ' secret ' })).toEqual({
      clientId: 'app-id',
      clientSecret: 'secret',
    })
    expect(metaAdsStrategy.getStaticClientRegistration({ appId: 'app-id' })).toBeNull()
    expect(metaAdsStrategy.preferStaticClientRegistration()).toBe(true)
    expect(metaAdsStrategy.shouldValidateMetadataEndpoints()).toBe(false)
    expect(metaAdsStrategy.usesPkce()).toBe(false)
    await expect(metaAdsStrategy.resolveTokenEndpoint('https://graph.facebook.com/token')).resolves.toBe('https://graph.facebook.com/token')
    await expect(metaAdsStrategy.resolveRefreshTokenEndpoint({})).rejects.toThrow('oauth_refresh_failed:unsupported_provider')
  })

  it('resolves Notion static env and metadata settings', async () => {
    process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID = ' notion-client '
    process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET = ' notion-secret '
    process.env.ARCHE_CONNECTOR_NOTION_MCP_URL = 'https://notion.example.com/mcp'
    process.env.ARCHE_CONNECTOR_NOTION_SCOPE = 'read pages'

    await expect(notionStrategy.getMcpServerUrl()).resolves.toBe('https://notion.example.com/mcp')
    expect(notionStrategy.getScope()).toBe('read pages')
    expect(notionStrategy.getStaticClientRegistration()).toEqual({
      clientId: 'notion-client',
      clientSecret: 'notion-secret',
    })
    expect(notionStrategy.preferStaticClientRegistration()).toBe(false)
    await expect(notionStrategy.getMetadataOverrides()).resolves.toEqual({})
    expect(notionStrategy.shouldValidateMetadataEndpoints()).toBe(false)
    expect(notionStrategy.usesPkce()).toBe(true)
    await expect(notionStrategy.resolveTokenEndpoint('https://notion.example.com/token')).resolves.toBe('https://notion.example.com/token')
    await expect(notionStrategy.resolveRefreshTokenEndpoint({})).resolves.toBe('https://auth.example.com/token')
  })

  it('returns registered strategies by connector type', () => {
    expect(getStrategy('custom')).toBe(customStrategy)
    expect(getStrategy('linear')).toBe(linearStrategy)
    expect(getStrategy('meta-ads')).toBe(metaAdsStrategy)
    expect(getStrategy('notion')).toBe(notionStrategy)
  })
})
