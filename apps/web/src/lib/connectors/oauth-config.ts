import { isOAuthConnectorType } from '@/lib/connectors/oauth'
import type { ConnectorType, OAuthConnectorType } from '@/lib/connectors/types'

export type ConnectorOAuthConfig = {
  provider: OAuthConnectorType
  accessToken: string
  refreshToken?: string
  tokenType?: string
  scope?: string
  expiresAt?: string
  connectedAt: string
  clientId: string
  clientSecret?: string
  tokenEndpoint?: string
  authorizationEndpoint?: string
  registrationEndpoint?: string
  issuer?: string
  mcpServerUrl?: string
}

type ConnectorConfigRecord = Record<string, unknown>

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function getConnectorAuthType(config: ConnectorConfigRecord): 'manual' | 'oauth' {
  return config.authType === 'oauth' ? 'oauth' : 'manual'
}

export function getConnectorOAuthConfig(
  type: ConnectorType,
  config: ConnectorConfigRecord
): ConnectorOAuthConfig | null {
  if (!isOAuthConnectorType(type)) return null
  const entry = config.oauth
  if (!isObject(entry)) return null

  const provider = getString(entry.provider)
  const accessToken = getString(entry.accessToken)
  const clientId = getString(entry.clientId)
  if (!provider || !accessToken || !clientId || provider !== type) return null

  return {
    provider: type,
    accessToken,
    clientId,
    refreshToken: getString(entry.refreshToken),
    tokenType: getString(entry.tokenType),
    scope: getString(entry.scope),
    expiresAt: getString(entry.expiresAt),
    connectedAt: getString(entry.connectedAt) ?? new Date().toISOString(),
    clientSecret: getString(entry.clientSecret),
    tokenEndpoint: getString(entry.tokenEndpoint),
    authorizationEndpoint: getString(entry.authorizationEndpoint),
    registrationEndpoint: getString(entry.registrationEndpoint),
    issuer: getString(entry.issuer),
    mcpServerUrl: getString(entry.mcpServerUrl),
  }
}

export function buildConfigWithOAuth(input: {
  connectorType: OAuthConnectorType
  currentConfig: ConnectorConfigRecord
  oauth: Omit<ConnectorOAuthConfig, 'provider' | 'connectedAt'> & { connectedAt?: string }
}): ConnectorConfigRecord {
  const next: ConnectorConfigRecord = {
    ...input.currentConfig,
    authType: 'oauth',
    oauth: {
      provider: input.connectorType,
      clientId: input.oauth.clientId,
      accessToken: input.oauth.accessToken,
      refreshToken: input.oauth.refreshToken,
      tokenType: input.oauth.tokenType,
      scope: input.oauth.scope,
      expiresAt: input.oauth.expiresAt,
      connectedAt: input.oauth.connectedAt ?? new Date().toISOString(),
      clientSecret: input.oauth.clientSecret,
      tokenEndpoint: input.oauth.tokenEndpoint,
      authorizationEndpoint: input.oauth.authorizationEndpoint,
      registrationEndpoint: input.oauth.registrationEndpoint,
      issuer: input.oauth.issuer,
      mcpServerUrl: input.oauth.mcpServerUrl,
    },
  }

  return next
}

export function mergeConnectorConfigWithPreservedOAuth(input: {
  connectorType: ConnectorType
  currentConfig: ConnectorConfigRecord
  nextConfig: ConnectorConfigRecord
}): ConnectorConfigRecord {
  const next = { ...input.nextConfig }

  if (getConnectorAuthType(next) !== 'oauth' || !isOAuthConnectorType(input.connectorType)) {
    return next
  }

  if ((input.connectorType === 'custom' || input.connectorType === 'linear') && next.oauthClientSecret === undefined) {
    const currentClientSecret = getString(input.currentConfig.oauthClientSecret)
    if (currentClientSecret) {
      next.oauthClientSecret = currentClientSecret
    }
  }

  if (!isObject(input.currentConfig.oauth)) {
    return next
  }

  if (next.oauth === undefined) {
    next.oauth = { ...input.currentConfig.oauth }
    return next
  }

  if (isObject(next.oauth)) {
    next.oauth = {
      ...input.currentConfig.oauth,
      ...next.oauth,
    }
  }

  return next
}

export function clearConnectorOAuthConfig(currentConfig: ConnectorConfigRecord): ConnectorConfigRecord {
  const next = { ...currentConfig }
  delete next.oauth
  return currentConfig.authType === 'oauth'
    ? { ...next, authType: 'oauth' }
    : { ...next, authType: 'manual' }
}

export function isOAuthTokenExpiringSoon(oauth: ConnectorOAuthConfig, withinSeconds = 120): boolean {
  if (!oauth.expiresAt) return false
  const expires = Date.parse(oauth.expiresAt)
  if (!Number.isFinite(expires)) return false
  return expires - Date.now() <= withinSeconds * 1000
}
