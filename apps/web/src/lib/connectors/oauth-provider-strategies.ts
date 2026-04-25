import { getLinearOAuthActor, getLinearOAuthClientCredentials } from '@/lib/connectors/linear'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'
import type { OAuthConnectorType } from '@/lib/connectors/types'
import { discoverOAuthMetadata, sanitizeOAuthMetadata } from '@/lib/connectors/oauth'

type OAuthMetadataOverrides = {
  authorizationEndpoint?: string
  tokenEndpoint?: string
  registrationEndpoint?: string
}

type OAuthClientRegistration = {
  clientId: string
  clientSecret?: string
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function validateConnectorUrl(rawUrl: string): Promise<string> {
  const validation = await validateConnectorTestEndpoint(rawUrl)
  if (!validation.ok) {
    throw new Error(validation.error)
  }
  return validation.url.toString()
}

const MCP_SERVER_URLS = {
  linear: 'https://mcp.linear.app/mcp',
  notion: 'https://mcp.notion.com/mcp',
} as const

const LINEAR_APP_ACTOR_OAUTH_METADATA: OAuthMetadataOverrides = {
  authorizationEndpoint: 'https://linear.app/oauth/authorize',
  tokenEndpoint: 'https://api.linear.app/oauth/token',
}

function getOptionalScope(type: Exclude<OAuthConnectorType, 'custom'>): string | undefined {
  if (type === 'linear') {
    const value = process.env.ARCHE_CONNECTOR_LINEAR_SCOPE
    return value && value.trim() ? value.trim() : undefined
  }

  const value = process.env.ARCHE_CONNECTOR_NOTION_SCOPE
  return value && value.trim() ? value.trim() : undefined
}

function getOfficialMcpServerUrl(type: Exclude<OAuthConnectorType, 'custom'>): string {
  if (type === 'linear') {
    return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || MCP_SERVER_URLS.linear
  }

  return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || MCP_SERVER_URLS.notion
}

export type OAuthProviderStrategy = {
  getMcpServerUrl(connectorConfig?: Record<string, unknown>): Promise<string>
  getScope(connectorConfig?: Record<string, unknown>): string | undefined
  getStaticClientRegistration(connectorConfig?: Record<string, unknown>): OAuthClientRegistration | null
  preferStaticClientRegistration(connectorConfig?: Record<string, unknown>): boolean
  getMetadataOverrides(connectorConfig?: Record<string, unknown>): Promise<OAuthMetadataOverrides>
  shouldValidateMetadataEndpoints(): boolean
  decorateAuthorizeUrl(url: URL, connectorConfig?: Record<string, unknown>): void
  resolveTokenEndpoint(tokenEndpoint: string): Promise<string>
  resolveRefreshTokenEndpoint(input: {
    tokenEndpoint?: string
    mcpServerUrl?: string
  }): Promise<string>
}

const linearStrategy: OAuthProviderStrategy = {
  async getMcpServerUrl(): Promise<string> {
    return getOfficialMcpServerUrl('linear')
  },
  getScope(connectorConfig?: Record<string, unknown>): string | undefined {
    return getString(connectorConfig?.oauthScope) ?? getOptionalScope('linear')
  },
  getStaticClientRegistration(connectorConfig?: Record<string, unknown>): OAuthClientRegistration | null {
    if (!connectorConfig || getLinearOAuthActor(connectorConfig) !== 'app') return null
    return getLinearOAuthClientCredentials(connectorConfig)
  },
  preferStaticClientRegistration(connectorConfig?: Record<string, unknown>): boolean {
    return connectorConfig !== undefined && getLinearOAuthActor(connectorConfig) === 'app'
  },
  async getMetadataOverrides(connectorConfig?: Record<string, unknown>): Promise<OAuthMetadataOverrides> {
    return this.preferStaticClientRegistration(connectorConfig) ? LINEAR_APP_ACTOR_OAUTH_METADATA : {}
  },
  shouldValidateMetadataEndpoints(): boolean {
    return false
  },
  decorateAuthorizeUrl(url: URL, connectorConfig?: Record<string, unknown>): void {
    if (connectorConfig && getLinearOAuthActor(connectorConfig) === 'app') {
      url.searchParams.set('actor', 'app')
    }
  },
  async resolveTokenEndpoint(tokenEndpoint: string): Promise<string> {
    return tokenEndpoint
  },
  async resolveRefreshTokenEndpoint(input: { tokenEndpoint?: string; mcpServerUrl?: string }): Promise<string> {
    if (input.tokenEndpoint) return input.tokenEndpoint
    const metadata = await discoverOAuthMetadata(getOfficialMcpServerUrl('linear'))
    return metadata.tokenEndpoint
  },
}

const notionStrategy: OAuthProviderStrategy = {
  async getMcpServerUrl(): Promise<string> {
    return getOfficialMcpServerUrl('notion')
  },
  getScope(): string | undefined {
    return getOptionalScope('notion')
  },
  getStaticClientRegistration(): OAuthClientRegistration | null {
    const clientId = process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID
    if (!clientId || !clientId.trim()) return null
    const clientSecret = process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET
    return {
      clientId: clientId.trim(),
      clientSecret: clientSecret?.trim() || undefined,
    }
  },
  preferStaticClientRegistration(): boolean {
    return false
  },
  async getMetadataOverrides(): Promise<OAuthMetadataOverrides> {
    return {}
  },
  shouldValidateMetadataEndpoints(): boolean {
    return false
  },
  decorateAuthorizeUrl(): void {
    // No notion-specific URL decorations
  },
  async resolveTokenEndpoint(tokenEndpoint: string): Promise<string> {
    return tokenEndpoint
  },
  async resolveRefreshTokenEndpoint(input: { tokenEndpoint?: string; mcpServerUrl?: string }): Promise<string> {
    if (input.tokenEndpoint) return input.tokenEndpoint
    const metadata = await discoverOAuthMetadata(getOfficialMcpServerUrl('notion'))
    return metadata.tokenEndpoint
  },
}

const customStrategy: OAuthProviderStrategy = {
  async getMcpServerUrl(connectorConfig?: Record<string, unknown>): Promise<string> {
    const endpoint = getString(connectorConfig?.endpoint)
    if (!endpoint) {
      throw new Error('missing_endpoint')
    }
    return validateConnectorUrl(endpoint)
  },
  getScope(connectorConfig?: Record<string, unknown>): string | undefined {
    return getString(connectorConfig?.oauthScope)
  },
  getStaticClientRegistration(connectorConfig?: Record<string, unknown>): OAuthClientRegistration | null {
    const clientId = getString(connectorConfig?.oauthClientId)
    if (!clientId) return null
    return {
      clientId,
      clientSecret: getString(connectorConfig?.oauthClientSecret),
    }
  },
  preferStaticClientRegistration(): boolean {
    return false
  },
  async getMetadataOverrides(connectorConfig?: Record<string, unknown>): Promise<OAuthMetadataOverrides> {
    const authorizationEndpoint = getString(connectorConfig?.oauthAuthorizationEndpoint)
    const tokenEndpoint = getString(connectorConfig?.oauthTokenEndpoint)
    const registrationEndpoint = getString(connectorConfig?.oauthRegistrationEndpoint)

    return {
      authorizationEndpoint: authorizationEndpoint
        ? await validateConnectorUrl(authorizationEndpoint)
        : undefined,
      tokenEndpoint: tokenEndpoint ? await validateConnectorUrl(tokenEndpoint) : undefined,
      registrationEndpoint: registrationEndpoint
        ? await validateConnectorUrl(registrationEndpoint)
        : undefined,
    }
  },
  shouldValidateMetadataEndpoints(): boolean {
    return true
  },
  decorateAuthorizeUrl(): void {
    // No custom-specific URL decorations
  },
  async resolveTokenEndpoint(tokenEndpoint: string): Promise<string> {
    return validateConnectorUrl(tokenEndpoint)
  },
  async resolveRefreshTokenEndpoint(input: { tokenEndpoint?: string; mcpServerUrl?: string }): Promise<string> {
    if (input.tokenEndpoint) {
      return validateConnectorUrl(input.tokenEndpoint)
    }
    if (!input.mcpServerUrl) {
      throw new Error('oauth_refresh_failed:missing_mcp_server_url')
    }
    const safeMcpServerUrl = await validateConnectorUrl(input.mcpServerUrl)
    const metadata = await sanitizeOAuthMetadata(await discoverOAuthMetadata(safeMcpServerUrl))
    return metadata.tokenEndpoint
  },
}

export const strategies: Record<OAuthConnectorType, OAuthProviderStrategy> = {
  linear: linearStrategy,
  notion: notionStrategy,
  custom: customStrategy,
}

export function getStrategy(type: OAuthConnectorType): OAuthProviderStrategy {
  return strategies[type]
}
