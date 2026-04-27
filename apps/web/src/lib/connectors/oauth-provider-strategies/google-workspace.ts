import {
  getGoogleOAuthClientCredentials,
  getGoogleWorkspaceDefaultScope,
  getGoogleWorkspaceMcpServerUrl,
  GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT,
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
  type GoogleWorkspaceConnectorType,
} from '@/lib/connectors/google-workspace'
import type { OAuthMetadataOverrides, OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

function createGoogleWorkspaceStrategy(type: GoogleWorkspaceConnectorType): OAuthProviderStrategy {
  return {
    async getMcpServerUrl(): Promise<string> {
      return getGoogleWorkspaceMcpServerUrl(type)
    },
    getScope(): string | undefined {
      return getGoogleWorkspaceDefaultScope(type)
    },
    getStaticClientRegistration(connectorConfig?: Record<string, unknown>) {
      const runtimeConfig = connectorConfig as { clientId?: string; clientSecret?: string } | undefined
      return getGoogleOAuthClientCredentials(runtimeConfig)
    },
    preferStaticClientRegistration(): boolean {
      return true
    },
    async getMetadataOverrides(): Promise<OAuthMetadataOverrides> {
      return {
        authorizationEndpoint: GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT,
        tokenEndpoint: GOOGLE_OAUTH_TOKEN_ENDPOINT,
      }
    },
    shouldValidateMetadataEndpoints(): boolean {
      return false
    },
    decorateAuthorizeUrl(url: URL): void {
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
    },
    usesPkce(): boolean {
      return true
    },
    async resolveTokenEndpoint(tokenEndpoint: string): Promise<string> {
      return tokenEndpoint
    },
    async resolveRefreshTokenEndpoint(input: { tokenEndpoint?: string; mcpServerUrl?: string }): Promise<string> {
      if (input.tokenEndpoint) return input.tokenEndpoint
      return GOOGLE_OAUTH_TOKEN_ENDPOINT
    },
  }
}

export const googleGmailStrategy = createGoogleWorkspaceStrategy('google_gmail')
export const googleDriveStrategy = createGoogleWorkspaceStrategy('google_drive')
export const googleCalendarStrategy = createGoogleWorkspaceStrategy('google_calendar')
export const googleChatStrategy = createGoogleWorkspaceStrategy('google_chat')
export const googlePeopleStrategy = createGoogleWorkspaceStrategy('google_people')
