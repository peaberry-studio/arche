import { describe, expect, it } from 'vitest'

import { sanitizeConnectorConfigForResponse } from '@/lib/connectors/response-config'

describe('sanitizeConnectorConfigForResponse', () => {
  it('removes Meta Ads app secrets from valid and invalid configs', () => {
    expect(sanitizeConnectorConfigForResponse('meta-ads', {
      authType: 'oauth',
      appId: 'app-id',
      appSecret: 'secret',
      permissions: { allowRead: true },
      selectedAdAccountIds: ['act_1'],
    })).toMatchObject({
      authType: 'oauth',
      appId: 'app-id',
      appSecret: undefined,
      hasAppSecret: true,
      selectedAdAccountIds: ['act_1'],
    })

    expect(sanitizeConnectorConfigForResponse('meta-ads', {
      appSecret: 'secret',
      unexpected: 'value',
    })).toEqual({ unexpected: 'value' })
  })

  it('returns non-OAuth configs unchanged', () => {
    const config = { authType: 'manual', endpoint: 'https://mcp.example.com' }

    expect(sanitizeConnectorConfigForResponse('custom', config)).toBe(config)
  })

  it('redacts OAuth credentials while preserving connection metadata', () => {
    expect(sanitizeConnectorConfigForResponse('custom', {
      authType: 'oauth',
      endpoint: 'https://mcp.example.com',
      oauthClientSecret: 'client-secret',
      oauth: {
        provider: 'custom',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        clientId: 'client-id',
        clientSecret: 'nested-client-secret',
        connectedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-02T00:00:00.000Z',
        scope: 'read write',
      },
    })).toEqual({
      authType: 'oauth',
      endpoint: 'https://mcp.example.com',
      oauth: {
        provider: 'custom',
        connected: true,
        connectedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-02T00:00:00.000Z',
        scope: 'read write',
      },
    })
  })
})
