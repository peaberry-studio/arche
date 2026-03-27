const DEFAULT_CONNECTOR_GATEWAY_BASE_URL = 'http://web:3000/api/internal/mcp/connectors'

export function getConnectorGatewayTokenSecret(): string {
  const dedicated = process.env.ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET
  if (dedicated && dedicated.trim()) return dedicated.trim()

  const shared = process.env.ARCHE_GATEWAY_TOKEN_SECRET
  if (shared && shared.trim()) return shared.trim()

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET (or ARCHE_GATEWAY_TOKEN_SECRET) is required in production')
  }

  console.warn('[security] Using insecure development secret for connector gateway token. Set ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET (or ARCHE_GATEWAY_TOKEN_SECRET) env var.')
  return 'dev-insecure-connector-gateway-secret'
}

export function getConnectorGatewayTokenTtlSeconds(): number {
  const raw = process.env.ARCHE_CONNECTOR_GATEWAY_TOKEN_TTL_SECONDS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 86400
}

export function getConnectorGatewayBaseUrl(): string {
  const configured = process.env.ARCHE_CONNECTOR_GATEWAY_BASE_URL || DEFAULT_CONNECTOR_GATEWAY_BASE_URL
  return configured.endsWith('/') ? configured.slice(0, -1) : configured
}
