import { discoverOAuthMetadata, getString } from '@/lib/connectors/oauth-metadata'
import { getLinearOAuthActor, getLinearOAuthClientCredentials } from '@/lib/connectors/linear'
import type { OAuthMetadataOverrides, OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

const LINEAR_DEFAULT_MCP_URL = 'https://mcp.linear.app/mcp'

const LINEAR_APP_ACTOR_OAUTH_METADATA: OAuthMetadataOverrides = {
  authorizationEndpoint: 'https://linear.app/oauth/authorize',
  tokenEndpoint: 'https://api.linear.app/oauth/token',
}

function getOptionalScope(): string | undefined {
  const value = process.env.ARCHE_CONNECTOR_LINEAR_SCOPE
  return value && value.trim() ? value.trim() : undefined
}

function getOfficialMcpServerUrl(): string {
  return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || LINEAR_DEFAULT_MCP_URL
}

export const linearStrategy: OAuthProviderStrategy = {
  async getMcpServerUrl(): Promise<string> {
    return getOfficialMcpServerUrl()
  },
  getScope(connectorConfig?: Record<string, unknown>): string | undefined {
    return getString(connectorConfig?.oauthScope) ?? getOptionalScope()
  },
  getStaticClientRegistration(connectorConfig?: Record<string, unknown>) {
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
  usesPkce(): boolean {
    return true
  },
  async resolveTokenEndpoint(tokenEndpoint: string): Promise<string> {
    return tokenEndpoint
  },
  async resolveRefreshTokenEndpoint(input: { tokenEndpoint?: string; mcpServerUrl?: string }): Promise<string> {
    if (input.tokenEndpoint) return input.tokenEndpoint
    const metadata = await discoverOAuthMetadata(getOfficialMcpServerUrl())
    return metadata.tokenEndpoint
  },
}
