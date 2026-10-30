import { parseMetaAdsConnectorConfig } from '@/lib/connectors/meta-ads'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { CONNECTOR_PRIVATE_FIELDS } from '@/lib/connectors/private-fields'
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

function sanitizeGithubConfigForResponse(config: Record<string, unknown>): Record<string, unknown> {
  const sanitizedConfig = { ...config }
  delete sanitizedConfig.pat

  return {
    ...sanitizedConfig,
    hasPat: typeof config.pat === 'string' && config.pat.length > 0,
  }
}

const CONNECTOR_CONFIG_SANITIZERS: Partial<Record<ConnectorType, ConnectorConfigSanitizer>> = {
  github: sanitizeGithubConfigForResponse,
  'meta-ads': sanitizeMetaAdsConfigForResponse,
}

export function sanitizeConnectorConfigForResponse(
  type: ConnectorType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sanitizer = CONNECTOR_CONFIG_SANITIZERS[type]
  const sanitizedConfig = sanitizer ? sanitizer(config) : { ...config }
  delete sanitizedConfig.oauthPendingState
  for (const [field, presence] of Object.entries(CONNECTOR_PRIVATE_FIELDS)) {
    if (field in sanitizedConfig) {
      delete sanitizedConfig[field]
      sanitizedConfig[presence] = Boolean(config[field])
    }
  }
  if (getConnectorAuthType(config) !== 'oauth') return sanitizedConfig
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
