import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { GatewayTokenPayload } from '@/lib/providers/tokens'

describe('providers/config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getGatewayTokenSecret', () => {
    it('returns secret from env when set', async () => {
      process.env.ARCHE_GATEWAY_TOKEN_SECRET = 'test-secret'

      const { getGatewayTokenSecret } = await import('@/lib/providers/config')

      expect(getGatewayTokenSecret()).toBe('test-secret')
    })

    it('throws in production when secret is missing', async () => {
      delete process.env.ARCHE_GATEWAY_TOKEN_SECRET
      process.env.NODE_ENV = 'production'

      const { getGatewayTokenSecret } = await import('@/lib/providers/config')

      expect(() => getGatewayTokenSecret()).toThrow('ARCHE_GATEWAY_TOKEN_SECRET is required in production')
    })

    it('returns dev secret when missing outside production', async () => {
      delete process.env.ARCHE_GATEWAY_TOKEN_SECRET
      process.env.NODE_ENV = 'development'

      const { getGatewayTokenSecret } = await import('@/lib/providers/config')

      expect(getGatewayTokenSecret()).toBe('dev-insecure-gateway-secret')
    })
  })

  describe('getGatewayTokenTtlSeconds', () => {
    it('returns default when env is missing', async () => {
      delete process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS

      const { getGatewayTokenTtlSeconds } = await import('@/lib/providers/config')

      expect(getGatewayTokenTtlSeconds()).toBe(900)
    })

    it('floors custom ttl from env', async () => {
      process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = '1200.9'

      const { getGatewayTokenTtlSeconds } = await import('@/lib/providers/config')

      expect(getGatewayTokenTtlSeconds()).toBe(1200)
    })
  })

  describe('getGatewayBaseUrlForProvider', () => {
    it('returns fallback base url when env missing', async () => {
      delete process.env.ARCHE_GATEWAY_BASE_URL

      const { getGatewayBaseUrlForProvider } = await import('@/lib/providers/config')

      expect(getGatewayBaseUrlForProvider('openai')).toBe('http://web:3000/api/internal/providers/openai')
    })

    it('uses configured base url', async () => {
      process.env.ARCHE_GATEWAY_BASE_URL = 'https://gateway.internal'

      const { getGatewayBaseUrlForProvider } = await import('@/lib/providers/config')

      expect(getGatewayBaseUrlForProvider('anthropic')).toBe('https://gateway.internal/anthropic')
    })
  })
})

describe('providers/tokens', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    process.env.ARCHE_GATEWAY_TOKEN_SECRET = 'token-secret'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
  })

  it('issues token with base64url payload and signature', async () => {
    process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = '60'

    const { issueGatewayToken, verifyGatewayToken } = await import('@/lib/providers/tokens')
    const exp = Math.floor(Date.now() / 1000) + 60
    const payload: GatewayTokenPayload = {
      userId: 'user-1',
      workspaceSlug: 'acme',
      providerId: 'openai',
      version: 1,
      exp,
    }

    const token = issueGatewayToken({
      userId: 'user-1',
      workspaceSlug: 'acme',
      providerId: 'openai',
      version: 1,
    })
    const [payloadPart, sigPart] = token.split('.')

    expect(payloadPart).toBe(Buffer.from(JSON.stringify(payload)).toString('base64url'))
    expect(sigPart.length).toBeGreaterThan(0)
    expect(verifyGatewayToken(token)).toEqual(payload)
  })

  it('rejects tokens with invalid format', async () => {
    const { verifyGatewayToken } = await import('@/lib/providers/tokens')

    expect(() => verifyGatewayToken('no-dot')).toThrow('invalid_token')
  })

  it('rejects tokens with invalid signature', async () => {
    const { issueGatewayToken, verifyGatewayToken } = await import('@/lib/providers/tokens')
    const token = issueGatewayToken({
      userId: 'user-2',
      workspaceSlug: 'acme',
      providerId: 'anthropic',
      version: 1,
    })
    const [payloadPart] = token.split('.')
    const forged = `${payloadPart}.bad-signature`

    expect(() => verifyGatewayToken(forged)).toThrow('invalid_token')
  })

  it('rejects expired tokens', async () => {
    process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = '1'

    const { issueGatewayToken, verifyGatewayToken } = await import('@/lib/providers/tokens')
    const token = issueGatewayToken({
      userId: 'user-3',
      workspaceSlug: 'acme',
      providerId: 'openai',
      version: 1,
    })

    vi.setSystemTime(new Date('2025-01-01T00:00:02Z'))

    expect(() => verifyGatewayToken(token)).toThrow('token_expired')
  })
})
