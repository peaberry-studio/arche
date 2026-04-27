import { parseMetaAdsConnectorConfig } from '@/lib/connectors/meta-ads'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import type { ConnectorType } from '@/lib/connectors/types'

type ConnectorConfigSanitizer = (config: Record<string, unknown>) => Record<string, unknown>

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeMetaAdsConfigForResponse(config: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseMetaAdsConnectorConfig(config)
  if (!parsed.ok) {
    const sanitizedConfig = { ...config }
    delete sanitizedConfig.appSecret
    return sanitizedConfig
  }

  return {
    ...parsed.value,
    appSecret: undefined,
    hasAppSecret: true,
  }
}

const CONNECTOR_CONFIG_SANITIZERS: Partial<Record<ConnectorType, ConnectorConfigSanitizer>> = {
  'meta-ads': sanitizeMetaAdsConfigForResponse,
}

export function sanitizeConnectorConfigForResponse(
  type: ConnectorType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sanitizer = CONNECTOR_CONFIG_SANITIZERS[type]
  if (sanitizer) return sanitizer(config)

  if (getConnectorAuthType(config) !== 'oauth') return config

  const sanitizedConfig = { ...config }
  if (type === 'custom' || type === 'linear') {
    delete sanitizedConfig.oauthClientSecret
  }

  if (isObjectRecord(sanitizedConfig.oauth)) {
    const oauthSanitized = { ...sanitizedConfig.oauth }
    delete oauthSanitized.accessToken
    delete oauthSanitized.refreshToken
    delete oauthSanitized.clientSecret
    sanitizedConfig.oauth = oauthSanitized
  }

  const oauth = getConnectorOAuthConfig(type, config)
  if (!oauth) return sanitizedConfig

  return {
    ...sanitizedConfig,
    oauth: {
      provider: oauth.provider,
      connected: true,
      expiresAt: oauth.expiresAt,
      connectedAt: oauth.connectedAt,
      scope: oauth.scope,
    },
  }
}
