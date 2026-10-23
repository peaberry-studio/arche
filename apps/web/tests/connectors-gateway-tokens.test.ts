import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConnectorGatewayTokenPayload } from '@/lib/connectors/gateway-tokens'

describe('connectors/gateway-tokens', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    process.env.ARCHE_GATEWAY_TOKEN_SECRET = 'connector-token-secret'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
  })

  it('issues token with base64url payload and signature', async () => {
    const { issueConnectorGatewayToken, verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
    const payload: ConnectorGatewayTokenPayload = {
      userId: 'user-1',
      workspaceSlug: 'inaki',
      credentialEpoch: 'epoch',
      connectorId: 'connector-1',
      iat: 1735689600, exp: 1735689900, aud: 'connector-gateway',
    }

    const token = issueConnectorGatewayToken({
      userId: 'user-1',
      workspaceSlug: 'inaki',
      credentialEpoch: 'epoch',
      connectorId: 'connector-1',
    })
    const [payloadPart, sigPart] = token.split('.')

    expect(payloadPart).toBe(Buffer.from(JSON.stringify(payload)).toString('base64url'))
    expect(sigPart.length).toBeGreaterThan(0)
    expect(verifyConnectorGatewayToken(token)).toEqual(payload)
  })

  it('rejects tokens with invalid signature', async () => {
    const { issueConnectorGatewayToken, verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
    const token = issueConnectorGatewayToken({
      userId: 'user-2',
      workspaceSlug: 'inaki',
      credentialEpoch: 'epoch',
      connectorId: 'connector-2',
    })
    const [payloadPart] = token.split('.')
    const forged = `${payloadPart}.bad-signature`

    expect(() => verifyConnectorGatewayToken(forged)).toThrow('invalid_token')
  })

  it('rejects tokens with invalid format', async () => {
    const { verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')

    expect(() => verifyConnectorGatewayToken('no-dot')).toThrow('invalid_token')
  })

  it('rejects expired tokens and accepts a newly issued credential', async () => {
    const { issueConnectorGatewayToken, verifyConnectorGatewayToken } = await import('@/lib/connectors/gateway-tokens')
    const token = issueConnectorGatewayToken({
      userId: 'user-3',
      workspaceSlug: 'inaki',
      credentialEpoch: 'epoch',
      connectorId: 'connector-3',
    })

    vi.setSystemTime(new Date('2025-01-07T00:00:00Z'))

    expect(() => verifyConnectorGatewayToken(token)).toThrow('invalid_token')
    const renewed = issueConnectorGatewayToken({ userId: 'user-3', workspaceSlug: 'inaki', connectorId: 'connector-3', credentialEpoch: 'epoch' })
    expect(verifyConnectorGatewayToken(renewed).exp).toBe(Math.floor(Date.now() / 1000) + 300)
  })
})
