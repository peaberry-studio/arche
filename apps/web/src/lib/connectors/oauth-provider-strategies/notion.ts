import { discoverOAuthMetadata } from '@/lib/connectors/oauth-metadata'
import type { OAuthMetadataOverrides, OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

const NOTION_DEFAULT_MCP_URL = 'https://mcp.notion.com/mcp'

function getOptionalScope(): string | undefined {
  const value = process.env.ARCHE_CONNECTOR_NOTION_SCOPE
  return value && value.trim() ? value.trim() : undefined
}

function getOfficialMcpServerUrl(): string {
  return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || NOTION_DEFAULT_MCP_URL
}

export const notionStrategy: OAuthProviderStrategy = {
  async getMcpServerUrl(): Promise<string> {
    return getOfficialMcpServerUrl()
  },
  getScope(): string | undefined {
    return getOptionalScope()
  },
  getStaticClientRegistration() {
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
