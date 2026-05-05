import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

let VALID_RSA_KEY: string

describe('github-app-auth', () => {
  beforeAll(() => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    })
    VALID_RSA_KEY = privateKey
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('createAppJwt', () => {
    it('returns a three-part JWT string', async () => {
      const { createAppJwt } = await import('../github-app-auth')
      const jwt = createAppJwt('12345', VALID_RSA_KEY)
      const parts = jwt.split('.')
      expect(parts).toHaveLength(3)
    })

    it('encodes correct header with RS256', async () => {
      const { createAppJwt } = await import('../github-app-auth')
      const jwt = createAppJwt('12345', VALID_RSA_KEY)
      const header = JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString())
      expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    })

    it('encodes app ID as issuer in payload', async () => {
      const { createAppJwt } = await import('../github-app-auth')
      const jwt = createAppJwt('67890', VALID_RSA_KEY)
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
      expect(payload.iss).toBe('67890')
      expect(payload.iat).toBeDefined()
      expect(payload.exp).toBeDefined()
      expect(payload.exp).toBeGreaterThan(payload.iat)
    })
  })

  describe('getInstallationToken', () => {
    it('returns token on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: 'ghs_abc123', expires_at: '2026-04-27T11:00:00Z' }),
      })

      const { getInstallationToken } = await import('../github-app-auth')
      const result = await getInstallationToken('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({
        ok: true,
        token: 'ghs_abc123',
        expiresAt: '2026-04-27T11:00:00Z',
      })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/99/access_tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'application/vnd.github+json',
          }),
        }),
      )
    })

    it('returns auth_failed on 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      const { getInstallationToken } = await import('../github-app-auth')
      const result = await getInstallationToken('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({
        ok: false,
        status: 'auth_failed',
        message: 'GitHub App credentials are invalid',
      })
    })

    it('returns not_found on 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      })

      const { getInstallationToken } = await import('../github-app-auth')
      const result = await getInstallationToken('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({
        ok: false,
        status: 'not_found',
        message: 'Installation not found — the app may have been uninstalled',
      })
    })

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { getInstallationToken } = await import('../github-app-auth')
      const result = await getInstallationToken('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({
        ok: false,
        status: 'error',
        message: 'Network error',
      })
    })
  })

  describe('getInstallationRepos', () => {
    it('returns repos list on success', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ token: 'ghs_token', expires_at: '2026-04-27T11:00:00Z' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              { full_name: 'owner/repo1', clone_url: 'https://github.com/owner/repo1.git', private: false },
              { full_name: 'owner/repo2', clone_url: 'https://github.com/owner/repo2.git', private: true },
            ],
          }),
        })

      const { getInstallationRepos } = await import('../github-app-auth')
      const result = await getInstallationRepos('12345', VALID_RSA_KEY, 99)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.repos).toEqual([
          { fullName: 'owner/repo1', cloneUrl: 'https://github.com/owner/repo1.git', private: false },
          { fullName: 'owner/repo2', cloneUrl: 'https://github.com/owner/repo2.git', private: true },
        ])
      }
    })

    it('returns error when token acquisition fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      const { getInstallationRepos } = await import('../github-app-auth')
      const result = await getInstallationRepos('12345', VALID_RSA_KEY, 99)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('invalid')
      }
    })
  })

  describe('verifyInstallation', () => {
    it('returns account name on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ account: { login: 'my-org' } }),
      })

      const { verifyInstallation } = await import('../github-app-auth')
      const result = await verifyInstallation('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({ ok: true, account: 'my-org' })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/99',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.github+json',
          }),
        }),
      )
    })

    it('returns error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      })

      const { verifyInstallation } = await import('../github-app-auth')
      const result = await verifyInstallation('12345', VALID_RSA_KEY, 99)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('404')
      }
    })

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'))

      const { verifyInstallation } = await import('../github-app-auth')
      const result = await verifyInstallation('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({ ok: false, message: 'timeout' })
    })
  })

  describe('getInstallationToken edge cases', () => {
    it('returns error on generic non-401/404 HTTP status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      const { getInstallationToken } = await import('../github-app-auth')
      const result = await getInstallationToken('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({
        ok: false,
        status: 'error',
        message: 'GitHub API returned 500: Internal Server Error',
      })
    })
  })

  describe('getInstallationRepos edge cases', () => {
    it('returns error on non-ok repos API response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ token: 'ghs_token', expires_at: '2026-04-27T11:00:00Z' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
        })

      const { getInstallationRepos } = await import('../github-app-auth')
      const result = await getInstallationRepos('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({
        ok: false,
        message: 'GitHub API returned 403',
      })
    })

    it('returns error on network failure during repos fetch', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ token: 'ghs_token', expires_at: '2026-04-27T11:00:00Z' }),
        })
        .mockRejectedValueOnce(new Error('ECONNRESET'))

      const { getInstallationRepos } = await import('../github-app-auth')
      const result = await getInstallationRepos('12345', VALID_RSA_KEY, 99)

      expect(result).toEqual({
        ok: false,
        message: 'ECONNRESET',
      })
    })
  })

  describe('exchangeManifestCode', () => {
    it('returns app credentials on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 12345,
          slug: 'arche-kb-sync',
          pem: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
          client_id: 'Iv1.abc123',
          webhook_secret: 'wh_secret',
          owner: { login: 'my-org' },
        }),
      })

      const { exchangeManifestCode } = await import('../github-app-auth')
      const result = await exchangeManifestCode('test_code')

      expect(result).toEqual({
        ok: true,
        appId: 12345,
        slug: 'arche-kb-sync',
        pem: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        clientId: 'Iv1.abc123',
        webhookSecret: 'wh_secret',
        owner: 'my-org',
      })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/app-manifests/test_code/conversions',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('returns error on expired code (404)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      })

      const { exchangeManifestCode } = await import('../github-app-auth')
      const result = await exchangeManifestCode('expired_code')

      expect(result).toEqual({
        ok: false,
        message: 'Invalid or expired manifest code',
      })
    })

    it('returns error on already-used code (422)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => 'Unprocessable Entity',
      })

      const { exchangeManifestCode } = await import('../github-app-auth')
      const result = await exchangeManifestCode('used_code')

      expect(result).toEqual({
        ok: false,
        message: 'Manifest code has already been used',
      })
    })

    it('returns error on generic HTTP error (not 404/422)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      const { exchangeManifestCode } = await import('../github-app-auth')
      const result = await exchangeManifestCode('any_code')

      expect(result).toEqual({
        ok: false,
        message: 'GitHub API returned 500: Internal Server Error',
      })
    })

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('connection refused'))

      const { exchangeManifestCode } = await import('../github-app-auth')
      const result = await exchangeManifestCode('any_code')

      expect(result).toEqual({
        ok: false,
        message: 'connection refused',
      })
    })
  })
})
