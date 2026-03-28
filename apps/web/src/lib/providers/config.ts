import type { ProviderId } from './types'

const DEFAULT_GATEWAY_BASE_URL = 'http://web:3000/api/internal/providers'

export function getGatewayTokenSecret(): string {
  const secret = process.env.ARCHE_GATEWAY_TOKEN_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARCHE_GATEWAY_TOKEN_SECRET is required in production')
  }
  console.warn('[security] Using insecure development secret for gateway token. Set ARCHE_GATEWAY_TOKEN_SECRET env var.')
  return 'dev-insecure-gateway-secret'
}

export function getGatewayTokenTtlSeconds(): number {
  const raw = process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 900
}

export function getGatewayBaseUrlForProvider(providerId: ProviderId): string {
  const base = process.env.ARCHE_GATEWAY_BASE_URL || DEFAULT_GATEWAY_BASE_URL
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base
  return `${normalized}/${providerId}`
}
