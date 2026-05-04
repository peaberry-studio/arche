import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockValidateConnectorTestEndpoint = vi.fn()

vi.mock('@/lib/security/ssrf', () => ({
  validateConnectorTestEndpoint: (...args: unknown[]) => mockValidateConnectorTestEndpoint(...args),
}))

describe('oauth-metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getString', () => {
    it('returns trimmed string for non-empty strings', async () => {
      const { getString } = await import('@/lib/connectors/oauth-metadata')
      expect(getString('hello')).toBe('hello')
      expect(getString('  hello  ')).toBe('hello')
    })

    it('returns undefined for non-strings or empty strings', async () => {
      const { getString } = await import('@/lib/connectors/oauth-metadata')
      expect(getString(undefined)).toBeUndefined()
      expect(getString(null)).toBeUndefined()
      expect(getString(123)).toBeUndefined()
      expect(getString('')).toBeUndefined()
      expect(getString('   ')).toBeUndefined()
    })
  })

  describe('validateConnectorUrl', () => {
    it('returns validated URL on success', async () => {
      mockValidateConnectorTestEndpoint.mockResolvedValue({ ok: true, url: new URL('https://example.com/oauth') })
      const { validateConnectorUrl } = await import('@/lib/connectors/oauth-metadata')
      const result = await validateConnectorUrl('https://example.com/oauth')
      expect(result).toBe('https://example.com/oauth')
    })

    it('throws when validation fails', async () => {
      mockValidateConnectorTestEndpoint.mockResolvedValue({ ok: false, error: 'blocked_endpoint' })
      const { validateConnectorUrl } = await import('@/lib/connectors/oauth-metadata')
      await expect(validateConnectorUrl('https://bad.com')).rejects.toThrow('blocked_endpoint')
    })
  })

  describe('sanitizeOAuthMetadata', () => {
    it('validates and sanitizes all endpoints', async () => {
      mockValidateConnectorTestEndpoint.mockResolvedValue({ ok: true, url: new URL('https://example.com/auth') })
      const { sanitizeOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      const result = await sanitizeOAuthMetadata({
        issuer: 'https://example.com',
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/token',
        registrationEndpoint: 'https://example.com/register',
      })
      expect(result).toEqual({
        issuer: 'https://example.com',
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/auth',
        registrationEndpoint: 'https://example.com/auth',
      })
    })

    it('skips registrationEndpoint when undefined', async () => {
      mockValidateConnectorTestEndpoint.mockResolvedValue({ ok: true, url: new URL('https://example.com/auth') })
      const { sanitizeOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      const result = await sanitizeOAuthMetadata({
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/token',
      })
      expect(result.registrationEndpoint).toBeUndefined()
    })
  })

  describe('discoverOAuthMetadata', () => {
    it('returns metadata from well-known endpoint when available', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          issuer: 'https://example.com',
          authorization_endpoint: 'https://example.com/auth',
          token_endpoint: 'https://example.com/token',
          registration_endpoint: 'https://example.com/register',
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const { discoverOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      const result = await discoverOAuthMetadata('https://example.com/mcp')
      expect(result).toEqual({
        issuer: 'https://example.com',
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/token',
        registrationEndpoint: 'https://example.com/register',
      })
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/.well-known/oauth-authorization-server', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })

      vi.unstubAllGlobals()
    })

    it('throws when metadata response is missing required fields', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issuer: 'https://example.com' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const { discoverOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      await expect(discoverOAuthMetadata('https://example.com/mcp')).rejects.toThrow('oauth_discovery_failed:invalid_metadata')

      vi.unstubAllGlobals()
    })

    it('throws on non-404 error status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
      vi.stubGlobal('fetch', mockFetch)

      const { discoverOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      await expect(discoverOAuthMetadata('https://example.com/mcp')).rejects.toThrow('oauth_discovery_failed:500')

      vi.unstubAllGlobals()
    })

    it('falls back to default endpoints on 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
      vi.stubGlobal('fetch', mockFetch)

      const { discoverOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      const result = await discoverOAuthMetadata('https://example.com/mcp')
      expect(result).toEqual({
        authorizationEndpoint: 'https://example.com/authorize',
        tokenEndpoint: 'https://example.com/token',
        registrationEndpoint: 'https://example.com/register',
      })

      vi.unstubAllGlobals()
    })

    it('falls back to default endpoints when fetch throws', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('network error'))
      vi.stubGlobal('fetch', mockFetch)

      const { discoverOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      const result = await discoverOAuthMetadata('https://example.com/mcp')
      expect(result).toEqual({
        authorizationEndpoint: 'https://example.com/authorize',
        tokenEndpoint: 'https://example.com/token',
        registrationEndpoint: 'https://example.com/register',
      })

      vi.unstubAllGlobals()
    })

    it('throws when json parse fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => { throw new Error('bad json') },
      })
      vi.stubGlobal('fetch', mockFetch)

      const { discoverOAuthMetadata } = await import('@/lib/connectors/oauth-metadata')
      await expect(discoverOAuthMetadata('https://example.com/mcp')).rejects.toThrow('oauth_discovery_failed:invalid_metadata')

      vi.unstubAllGlobals()
    })
  })
})
