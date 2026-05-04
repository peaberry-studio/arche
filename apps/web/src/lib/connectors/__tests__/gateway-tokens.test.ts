import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetConnectorGatewayTokenSecret = vi.fn()

vi.mock('@/lib/connectors/gateway-config', () => ({
  getConnectorGatewayTokenSecret: () => mockGetConnectorGatewayTokenSecret(),
}))

describe('gateway-tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConnectorGatewayTokenSecret.mockReturnValue('test-secret')
  })

  describe('issueConnectorGatewayToken', () => {
    it('issues a token with encoded payload and signature', async () => {
      const { issueConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      const token = issueConnectorGatewayToken({
        userId: 'user-1',
        workspaceSlug: 'ws-1',
        connectorId: 'conn-1',
      })
      expect(token).toContain('.')
      const [encoded] = token.split('.')
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      expect(payload).toEqual({
        userId: 'user-1',
        workspaceSlug: 'ws-1',
        connectorId: 'conn-1',
      })
    })
  })

  describe('verifyConnectorGatewayToken', () => {
    it('verifies a valid token and returns payload', async () => {
      const { issueConnectorGatewayToken, verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      const token = issueConnectorGatewayToken({
        userId: 'user-1',
        workspaceSlug: 'ws-1',
        connectorId: 'conn-1',
      })
      const result = verifyConnectorGatewayToken(token)
      expect(result).toEqual({
        userId: 'user-1',
        workspaceSlug: 'ws-1',
        connectorId: 'conn-1',
      })
    })

    it('throws on malformed token (no dot)', async () => {
      const { verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      expect(() => verifyConnectorGatewayToken('notoken')).toThrow('invalid_token')
    })

    it('throws on malformed token (empty parts)', async () => {
      const { verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      expect(() => verifyConnectorGatewayToken('.')).toThrow('invalid_token')
      expect(() => verifyConnectorGatewayToken('abc.')).toThrow('invalid_token')
      expect(() => verifyConnectorGatewayToken('.def')).toThrow('invalid_token')
    })

    it('throws on invalid signature', async () => {
      const { issueConnectorGatewayToken, verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      const token = issueConnectorGatewayToken({
        userId: 'user-1',
        workspaceSlug: 'ws-1',
        connectorId: 'conn-1',
      })
      const [encoded] = token.split('.')
      expect(() => verifyConnectorGatewayToken(`${encoded}.bad-signature`)).toThrow('invalid_token')
    })

    it('throws on invalid payload shape', async () => {
      const { verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      const encoded = Buffer.from(JSON.stringify({})).toString('base64url')
      const signature = createHmac('sha256', 'test-secret').update(encoded).digest('base64url')
      expect(() => verifyConnectorGatewayToken(`${encoded}.${signature}`)).toThrow('invalid_token')
    })

    it('throws on array payload', async () => {
      const { verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      const encoded = Buffer.from(JSON.stringify([])).toString('base64url')
      const signature = createHmac('sha256', 'test-secret').update(encoded).digest('base64url')
      expect(() => verifyConnectorGatewayToken(`${encoded}.${signature}`)).toThrow('invalid_token')
    })

    it('throws on payload with empty fields', async () => {
      const { verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
      const encoded = Buffer.from(JSON.stringify({ userId: '', workspaceSlug: 'ws', connectorId: 'conn' })).toString('base64url')
      const signature = createHmac('sha256', 'test-secret').update(encoded).digest('base64url')
      expect(() => verifyConnectorGatewayToken(`${encoded}.${signature}`)).toThrow('invalid_token')
    })
  })
})
