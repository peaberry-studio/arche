const DEFAULT_META_ADS_GRAPH_API_VERSION = 'v25.0'

export const META_ADS_DEFAULT_OAUTH_SCOPE = 'ads_read'
export const META_ADS_MCP_PROTOCOL_VERSION = '2025-03-26'

export function getMetaAdsGraphApiVersion(): string {
  const raw = process.env.ARCHE_CONNECTOR_META_ADS_GRAPH_API_VERSION
  const trimmed = raw?.trim()

  if (!trimmed) {
    return DEFAULT_META_ADS_GRAPH_API_VERSION
  }

  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

export function getMetaAdsAuthorizationEndpoint(): string {
  return `https://www.facebook.com/${getMetaAdsGraphApiVersion()}/dialog/oauth`
}

export function getMetaAdsTokenEndpoint(): string {
  return `https://graph.facebook.com/${getMetaAdsGraphApiVersion()}/oauth/access_token`
}

export function getMetaAdsGraphApiBaseUrl(): string {
  return `https://graph.facebook.com/${getMetaAdsGraphApiVersion()}`
}
