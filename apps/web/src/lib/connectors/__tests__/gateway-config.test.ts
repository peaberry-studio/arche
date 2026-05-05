import { describe, expect, it, beforeEach, afterEach } from 'vitest'

describe('gateway-config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getConnectorGatewayTokenSecret', () => {
    it('returns dedicated env var when set', async () => {
      process.env.ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET = 'dedicated-secret'
      delete process.env.ARCHE_GATEWAY_TOKEN_SECRET
      const { getConnectorGatewayTokenSecret } = await import('@/lib/connectors/gateway-config')
      expect(getConnectorGatewayTokenSecret()).toBe('dedicated-secret')
    })

    it('falls back to shared env var when dedicated is not set', async () => {
      delete process.env.ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET
      process.env.ARCHE_GATEWAY_TOKEN_SECRET = 'shared-secret'
      const { getConnectorGatewayTokenSecret } = await import('@/lib/connectors/gateway-config')
      expect(getConnectorGatewayTokenSecret()).toBe('shared-secret')
    })

    it('throws in production when neither env var is set', async () => {
      delete process.env.ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET
      delete process.env.ARCHE_GATEWAY_TOKEN_SECRET
      process.env.NODE_ENV = 'production'
      const { getConnectorGatewayTokenSecret } = await import('@/lib/connectors/gateway-config')
      expect(() => getConnectorGatewayTokenSecret()).toThrow('ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET')
    })

    it('returns dev secret in non-production when env vars are missing', async () => {
      delete process.env.ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET
      delete process.env.ARCHE_GATEWAY_TOKEN_SECRET
      process.env.NODE_ENV = 'development'
      const { getConnectorGatewayTokenSecret } = await import('@/lib/connectors/gateway-config')
      expect(getConnectorGatewayTokenSecret()).toBe('dev-insecure-connector-gateway-secret')
    })

    it('trims whitespace from env vars', async () => {
      process.env.ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET = '  secret  '
      const { getConnectorGatewayTokenSecret } = await import('@/lib/connectors/gateway-config')
      expect(getConnectorGatewayTokenSecret()).toBe('secret')
    })
  })

  describe('getConnectorGatewayBaseUrl', () => {
    it('returns default URL when env var is not set', async () => {
      delete process.env.ARCHE_CONNECTOR_GATEWAY_BASE_URL
      const { getConnectorGatewayBaseUrl } = await import('@/lib/connectors/gateway-config')
      expect(getConnectorGatewayBaseUrl()).toBe('http://web:3000/api/internal/mcp/connectors')
    })

    it('returns configured URL', async () => {
      process.env.ARCHE_CONNECTOR_GATEWAY_BASE_URL = 'https://gateway.example.com'
      const { getConnectorGatewayBaseUrl } = await import('@/lib/connectors/gateway-config')
      expect(getConnectorGatewayBaseUrl()).toBe('https://gateway.example.com')
    })

    it('strips trailing slash', async () => {
      process.env.ARCHE_CONNECTOR_GATEWAY_BASE_URL = 'https://gateway.example.com/'
      const { getConnectorGatewayBaseUrl } = await import('@/lib/connectors/gateway-config')
      expect(getConnectorGatewayBaseUrl()).toBe('https://gateway.example.com')
    })
  })
})
