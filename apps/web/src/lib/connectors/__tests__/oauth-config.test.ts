import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsOAuthConnectorType = vi.fn()

vi.mock('@/lib/connectors/oauth', () => ({
  isOAuthConnectorType: (type: string) => mockIsOAuthConnectorType(type),
}))

describe('oauth-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getConnectorAuthType', () => {
    it('returns oauth when authType is oauth', async () => {
      const { getConnectorAuthType } = await import('@/lib/connectors/oauth-config')
      expect(getConnectorAuthType({ authType: 'oauth' })).toBe('oauth')
    })

    it('returns manual for any other authType', async () => {
      const { getConnectorAuthType } = await import('@/lib/connectors/oauth-config')
      expect(getConnectorAuthType({ authType: 'manual' })).toBe('manual')
      expect(getConnectorAuthType({})).toBe('manual')
    })
  })

  describe('getConnectorOAuthConfig', () => {
    it('returns null for non-OAuth connector types', async () => {
      mockIsOAuthConnectorType.mockReturnValue(false)
      const { getConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      const result = getConnectorOAuthConfig('zendesk', { oauth: { provider: 'zendesk', accessToken: 'tok', clientId: 'id' } })
      expect(result).toBeNull()
    })

    it('returns null when oauth entry is not an object', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { getConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      const result = getConnectorOAuthConfig('linear', { oauth: 'bad' })
      expect(result).toBeNull()
    })

    it('returns null when required fields are missing', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { getConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      expect(getConnectorOAuthConfig('linear', { oauth: { provider: 'linear' } })).toBeNull()
      expect(getConnectorOAuthConfig('linear', { oauth: { provider: 'linear', accessToken: 'tok' } })).toBeNull()
    })

    it('returns null when provider does not match type', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { getConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      const result = getConnectorOAuthConfig('linear', { oauth: { provider: 'notion', accessToken: 'tok', clientId: 'id' } })
      expect(result).toBeNull()
    })

    it('returns full config for valid input', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { getConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      const result = getConnectorOAuthConfig('linear', {
        oauth: {
          provider: 'linear',
          accessToken: 'tok',
          clientId: 'id',
          refreshToken: 'ref',
          tokenType: 'Bearer',
          scope: 'read',
          expiresAt: '2025-01-01T00:00:00Z',
          connectedAt: '2024-01-01T00:00:00Z',
          clientSecret: 'sec',
          tokenEndpoint: 'https://example.com/token',
          authorizationEndpoint: 'https://example.com/auth',
          registrationEndpoint: 'https://example.com/reg',
          issuer: 'https://example.com',
          mcpServerUrl: 'https://example.com/mcp',
        },
      })
      expect(result).toEqual({
        provider: 'linear',
        accessToken: 'tok',
        clientId: 'id',
        refreshToken: 'ref',
        tokenType: 'Bearer',
        scope: 'read',
        expiresAt: '2025-01-01T00:00:00Z',
        connectedAt: '2024-01-01T00:00:00Z',
        clientSecret: 'sec',
        tokenEndpoint: 'https://example.com/token',
        authorizationEndpoint: 'https://example.com/auth',
        registrationEndpoint: 'https://example.com/reg',
        issuer: 'https://example.com',
        mcpServerUrl: 'https://example.com/mcp',
      })
    })

    it('defaults connectedAt to now when missing', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { getConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      const result = getConnectorOAuthConfig('linear', {
        oauth: {
          provider: 'linear',
          accessToken: 'tok',
          clientId: 'id',
        },
      })
      expect(result).not.toBeNull()
      expect(result!.connectedAt).toBeDefined()
      expect(Date.parse(result!.connectedAt)).not.toBeNaN()
    })
  })

  describe('buildConfigWithOAuth', () => {
    it('builds config with OAuth fields', async () => {
      const { buildConfigWithOAuth } = await import('@/lib/connectors/oauth-config')
      const result = buildConfigWithOAuth({
        connectorType: 'linear',
        currentConfig: { existing: 'value' },
        oauth: {
          clientId: 'id',
          accessToken: 'tok',
        },
      })
      expect(result).toEqual({
        existing: 'value',
        authType: 'oauth',
        oauth: {
          provider: 'linear',
          clientId: 'id',
          accessToken: 'tok',
          refreshToken: undefined,
          tokenType: undefined,
          scope: undefined,
          expiresAt: undefined,
          connectedAt: expect.any(String),
          clientSecret: undefined,
          tokenEndpoint: undefined,
          authorizationEndpoint: undefined,
          registrationEndpoint: undefined,
          issuer: undefined,
          mcpServerUrl: undefined,
        },
      })
    })
  })

  describe('mergeConnectorConfigWithPreservedOAuth', () => {
    it('returns next config when authType is not oauth', async () => {
      const { mergeConnectorConfigWithPreservedOAuth } = await import('@/lib/connectors/oauth-config')
      const result = mergeConnectorConfigWithPreservedOAuth({
        connectorType: 'linear',
        currentConfig: { oauth: { provider: 'linear' } },
        nextConfig: { authType: 'manual' },
      })
      expect(result).toEqual({ authType: 'manual' })
    })

    it('returns next config when type is not OAuth', async () => {
      mockIsOAuthConnectorType.mockReturnValue(false)
      const { mergeConnectorConfigWithPreservedOAuth } = await import('@/lib/connectors/oauth-config')
      const result = mergeConnectorConfigWithPreservedOAuth({
        connectorType: 'zendesk',
        currentConfig: {},
        nextConfig: { authType: 'oauth' },
      })
      expect(result).toEqual({ authType: 'oauth' })
    })

    it('preserves oauthClientSecret for custom and linear when undefined in next', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { mergeConnectorConfigWithPreservedOAuth } = await import('@/lib/connectors/oauth-config')
      const result = mergeConnectorConfigWithPreservedOAuth({
        connectorType: 'linear',
        currentConfig: { oauthClientSecret: 'secret' },
        nextConfig: { authType: 'oauth' },
      })
      expect(result.oauthClientSecret).toBe('secret')
    })

    it('does not overwrite oauthClientSecret if already present', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { mergeConnectorConfigWithPreservedOAuth } = await import('@/lib/connectors/oauth-config')
      const result = mergeConnectorConfigWithPreservedOAuth({
        connectorType: 'linear',
        currentConfig: { oauthClientSecret: 'old' },
        nextConfig: { authType: 'oauth', oauthClientSecret: 'new' },
      })
      expect(result.oauthClientSecret).toBe('new')
    })

    it('copies current oauth when next oauth is undefined', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { mergeConnectorConfigWithPreservedOAuth } = await import('@/lib/connectors/oauth-config')
      const result = mergeConnectorConfigWithPreservedOAuth({
        connectorType: 'linear',
        currentConfig: { oauth: { provider: 'linear', accessToken: 'tok' } },
        nextConfig: { authType: 'oauth' },
      })
      expect(result.oauth).toEqual({ provider: 'linear', accessToken: 'tok' })
    })

    it('merges current and next oauth objects', async () => {
      mockIsOAuthConnectorType.mockReturnValue(true)
      const { mergeConnectorConfigWithPreservedOAuth } = await import('@/lib/connectors/oauth-config')
      const result = mergeConnectorConfigWithPreservedOAuth({
        connectorType: 'linear',
        currentConfig: { oauth: { provider: 'linear', accessToken: 'old' } },
        nextConfig: { authType: 'oauth', oauth: { accessToken: 'new' } },
      })
      expect(result.oauth).toEqual({ provider: 'linear', accessToken: 'new' })
    })
  })

  describe('clearConnectorOAuthConfig', () => {
    it('removes oauth and sets authType to manual when it was manual', async () => {
      const { clearConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      const result = clearConnectorOAuthConfig({ authType: 'manual', oauth: { provider: 'linear' } })
      expect(result).toEqual({ authType: 'manual' })
    })

    it('removes oauth and keeps authType as oauth when it was oauth', async () => {
      const { clearConnectorOAuthConfig } = await import('@/lib/connectors/oauth-config')
      const result = clearConnectorOAuthConfig({ authType: 'oauth', oauth: { provider: 'linear' } })
      expect(result).toEqual({ authType: 'oauth' })
    })
  })

  describe('isOAuthTokenExpiringSoon', () => {
    it('returns false when no expiresAt', async () => {
      const { isOAuthTokenExpiringSoon } = await import('@/lib/connectors/oauth-config')
      expect(isOAuthTokenExpiringSoon({} as unknown as Parameters<typeof isOAuthTokenExpiringSoon>[0])).toBe(false)
    })

    it('returns false when expiresAt is invalid', async () => {
      const { isOAuthTokenExpiringSoon } = await import('@/lib/connectors/oauth-config')
      expect(isOAuthTokenExpiringSoon({ expiresAt: 'not-a-date' } as unknown as Parameters<typeof isOAuthTokenExpiringSoon>[0])).toBe(false)
    })

    it('returns true when token expires within default window', async () => {
      const { isOAuthTokenExpiringSoon } = await import('@/lib/connectors/oauth-config')
      const soon = new Date(Date.now() + 60_000).toISOString()
      expect(isOAuthTokenExpiringSoon({ expiresAt: soon } as unknown as Parameters<typeof isOAuthTokenExpiringSoon>[0])).toBe(true)
    })

    it('returns false when token expires after default window', async () => {
      const { isOAuthTokenExpiringSoon } = await import('@/lib/connectors/oauth-config')
      const later = new Date(Date.now() + 300_000).toISOString()
      expect(isOAuthTokenExpiringSoon({ expiresAt: later } as unknown as Parameters<typeof isOAuthTokenExpiringSoon>[0])).toBe(false)
    })

    it('respects custom withinSeconds', async () => {
      const { isOAuthTokenExpiringSoon } = await import('@/lib/connectors/oauth-config')
      const soon = new Date(Date.now() + 500_000).toISOString()
      expect(isOAuthTokenExpiringSoon({ expiresAt: soon } as unknown as Parameters<typeof isOAuthTokenExpiringSoon>[0], 600)).toBe(true)
    })
  })
})
