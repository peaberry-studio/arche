import { discoverOAuthMetadata, getString, sanitizeOAuthMetadata, validateConnectorUrl } from '@/lib/connectors/oauth-metadata'
import type { OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

export const customStrategy: OAuthProviderStrategy = {
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
  getStaticClientRegistration(connectorConfig?: Record<string, unknown>) {
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
  async getMetadataOverrides(connectorConfig?: Record<string, unknown>) {
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
  usesPkce(): boolean {
    return true
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
