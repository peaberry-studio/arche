import { describe, expect, it } from 'vitest'

import { buildConfigWithOAuth, getConnectorAuthType, getConnectorOAuthConfig, isOAuthTokenExpiringSoon } from '@/lib/connectors/oauth-config'
import { issueConnectorOAuthState, verifyConnectorOAuthState } from '@/lib/connectors/oauth'
import { validateConnectorConfig } from '@/lib/connectors/validators'

describe('connectors oauth state', () => {
  it('issues and verifies state token', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn1',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'linear',
    })

    const payload = verifyConnectorOAuthState(state)
    expect(payload.connectorId).toBe('conn1')
    expect(payload.slug).toBe('alice')
    expect(payload.userId).toBe('user1')
    expect(payload.connectorType).toBe('linear')
  })

  it('rejects tampered state token', () => {
    const state = issueConnectorOAuthState({
      connectorId: 'conn1',
      slug: 'alice',
      userId: 'user1',
      connectorType: 'notion',
    })

    const [encoded] = state.split('.')
    expect(() => verifyConnectorOAuthState(`${encoded}.tampered`)).toThrow('invalid_state')
  })
})

describe('connectors oauth config', () => {
  it('validates oauth mode without manual required fields', () => {
    expect(validateConnectorConfig('notion', { authType: 'oauth' })).toEqual({ valid: true })
    expect(validateConnectorConfig('linear', { authType: 'oauth' })).toEqual({ valid: true })
    expect(validateConnectorConfig('custom', { authType: 'oauth', endpoint: 'https://api.example.com/mcp' })).toEqual({
      valid: true,
    })
    expect(validateConnectorConfig('custom', { authType: 'oauth' })).toEqual({
      valid: false,
      missing: ['endpoint'],
    })
  })

  it('builds and parses oauth config', () => {
    const config = buildConfigWithOAuth({
      connectorType: 'linear',
      currentConfig: { org: 'acme' },
      oauth: {
        clientId: 'client-123',
        accessToken: 'token123',
        refreshToken: 'refresh123',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    })

    expect(getConnectorAuthType(config)).toBe('oauth')
    const oauth = getConnectorOAuthConfig('linear', config)
    expect(oauth?.clientId).toBe('client-123')
    expect(oauth?.accessToken).toBe('token123')
    expect(oauth?.refreshToken).toBe('refresh123')

    const customConfig = buildConfigWithOAuth({
      connectorType: 'custom',
      currentConfig: { endpoint: 'https://api.example.com/mcp' },
      oauth: {
        clientId: 'custom-client',
        accessToken: 'custom-token',
      },
    })
    const customOauth = getConnectorOAuthConfig('custom', customConfig)
    expect(customOauth?.provider).toBe('custom')
    expect(customOauth?.accessToken).toBe('custom-token')
  })

  it('detects token expiring soon', () => {
    const soon = new Date(Date.now() + 30_000).toISOString()
    const later = new Date(Date.now() + 600_000).toISOString()

    expect(
      isOAuthTokenExpiringSoon({
        provider: 'linear',
        clientId: 'client-123',
        accessToken: 'token',
        expiresAt: soon,
        connectedAt: new Date().toISOString(),
      })
    ).toBe(true)

    expect(
      isOAuthTokenExpiringSoon({
        provider: 'notion',
        clientId: 'client-123',
        accessToken: 'token',
        expiresAt: later,
        connectedAt: new Date().toISOString(),
      })
    ).toBe(false)
  })
})
