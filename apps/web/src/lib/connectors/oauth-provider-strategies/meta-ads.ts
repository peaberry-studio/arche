import {
  META_ADS_DEFAULT_OAUTH_SCOPE,
  getMetaAdsAuthorizationEndpoint,
  getMetaAdsTokenEndpoint,
} from '@/lib/connectors/meta-ads-shared'
import { getString } from '@/lib/connectors/oauth-metadata'
import type { OAuthMetadataOverrides, OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

export const metaAdsStrategy: OAuthProviderStrategy = {
  async getMcpServerUrl(): Promise<string> {
    return getMetaAdsAuthorizationEndpoint()
  },
  getScope(connectorConfig?: Record<string, unknown>): string | undefined {
    return getString(connectorConfig?.oauthScope) ?? META_ADS_DEFAULT_OAUTH_SCOPE
  },
  getStaticClientRegistration(connectorConfig?: Record<string, unknown>) {
    const clientId = getString(connectorConfig?.appId)
    const clientSecret = getString(connectorConfig?.appSecret)
    if (!clientId || !clientSecret) return null
    return {
      clientId,
      clientSecret,
    }
  },
  preferStaticClientRegistration(): boolean {
    return true
  },
  async getMetadataOverrides(): Promise<OAuthMetadataOverrides> {
    return {
      authorizationEndpoint: getMetaAdsAuthorizationEndpoint(),
      tokenEndpoint: getMetaAdsTokenEndpoint(),
    }
  },
  shouldValidateMetadataEndpoints(): boolean {
    return false
  },
  decorateAuthorizeUrl(): void {
    // No Meta Ads-specific URL decorations
  },
  usesPkce(): boolean {
    return false
  },
  async resolveTokenEndpoint(tokenEndpoint: string): Promise<string> {
    return tokenEndpoint
  },
  async resolveRefreshTokenEndpoint(): Promise<string> {
    throw new Error('oauth_refresh_failed:unsupported_provider')
  },
}
