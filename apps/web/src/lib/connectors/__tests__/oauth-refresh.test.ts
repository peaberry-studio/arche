import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDecryptConfig,
  mockEncryptConfig,
  mockBuildConfigWithOAuth,
  mockGetConnectorAuthType,
  mockGetConnectorOAuthConfig,
  mockIsOAuthTokenExpiringSoon,
  mockIsOAuthConnectorType,
  mockRefreshConnectorOAuthToken,
  mockValidateConnectorType,
  mockConnectorService,
} = vi.hoisted(() => ({
  mockDecryptConfig: vi.fn(),
  mockEncryptConfig: vi.fn(),
  mockBuildConfigWithOAuth: vi.fn(),
  mockGetConnectorAuthType: vi.fn(),
  mockGetConnectorOAuthConfig: vi.fn(),
  mockIsOAuthTokenExpiringSoon: vi.fn(),
  mockIsOAuthConnectorType: vi.fn(),
  mockRefreshConnectorOAuthToken: vi.fn(),
  mockValidateConnectorType: vi.fn(),
  mockConnectorService: { updateByIdUnsafe: vi.fn() },
}))

vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: mockDecryptConfig,
  encryptConfig: mockEncryptConfig,
}))
vi.mock('@/lib/connectors/oauth-config', () => ({
  buildConfigWithOAuth: mockBuildConfigWithOAuth,
  getConnectorAuthType: mockGetConnectorAuthType,
  getConnectorOAuthConfig: mockGetConnectorOAuthConfig,
  isOAuthTokenExpiringSoon: mockIsOAuthTokenExpiringSoon,
}))
vi.mock('@/lib/connectors/oauth', () => ({
  isOAuthConnectorType: mockIsOAuthConnectorType,
  refreshConnectorOAuthToken: mockRefreshConnectorOAuthToken,
}))
vi.mock('@/lib/connectors/validators', () => ({
  validateConnectorType: mockValidateConnectorType,
}))
vi.mock('@/lib/services', () => ({
  connectorService: mockConnectorService,
}))

import { refreshConnectorOAuthConfigIfNeeded } from '@/lib/connectors/oauth-refresh'

const CONNECTOR = { id: 'c1', type: 'linear', config: 'encrypted-data' }

const OAUTH_CONFIG = {
  accessToken: 'old-token',
  refreshToken: 'refresh-1',
  clientId: 'cid',
  clientSecret: 'csec',
  tokenEndpoint: 'https://auth/token',
  authorizationEndpoint: 'https://auth/authorize',
  registrationEndpoint: undefined,
  issuer: undefined,
  mcpServerUrl: 'https://mcp/linear',
  tokenType: 'bearer',
  scope: 'read',
  expiresAt: '2026-01-01T00:00:00Z',
}

describe('refreshConnectorOAuthConfigIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateConnectorType.mockReturnValue(true)
    mockIsOAuthConnectorType.mockReturnValue(true)
    mockDecryptConfig.mockReturnValue({ authType: 'oauth' })
    mockGetConnectorAuthType.mockReturnValue('oauth')
    mockGetConnectorOAuthConfig.mockReturnValue(OAUTH_CONFIG)
    mockIsOAuthTokenExpiringSoon.mockReturnValue(true)
    mockRefreshConnectorOAuthToken.mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'refresh-2',
      tokenType: 'bearer',
      scope: 'read',
      expiresAt: '2026-06-01T00:00:00Z',
    })
    mockBuildConfigWithOAuth.mockReturnValue({ authType: 'oauth', refreshed: true })
    mockEncryptConfig.mockReturnValue('new-encrypted')
  })

  it('refreshes and persists when token is expiring soon', async () => {
    const result = await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)
    expect(result).toBe('new-encrypted')
    expect(mockRefreshConnectorOAuthToken).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'linear',
        refreshToken: 'refresh-1',
      }),
    )
    expect(mockConnectorService.updateByIdUnsafe).toHaveBeenCalledWith('c1', { config: 'new-encrypted' })
  })

  it('returns null for invalid connector type', async () => {
    mockValidateConnectorType.mockReturnValue(false)
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('returns null for non-oauth connector type', async () => {
    mockIsOAuthConnectorType.mockReturnValue(false)
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('returns null when decryption fails', async () => {
    mockDecryptConfig.mockImplementation(() => { throw new Error('decrypt failed') })
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('returns null when auth type is manual', async () => {
    mockGetConnectorAuthType.mockReturnValue('manual')
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('returns null when oauth config is null', async () => {
    mockGetConnectorOAuthConfig.mockReturnValue(null)
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('returns null when no refresh token', async () => {
    mockGetConnectorOAuthConfig.mockReturnValue({ ...OAUTH_CONFIG, refreshToken: undefined })
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('returns null when token is not expiring soon', async () => {
    mockIsOAuthTokenExpiringSoon.mockReturnValue(false)
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('returns null when refresh throws', async () => {
    mockRefreshConnectorOAuthToken.mockRejectedValue(new Error('network'))
    expect(await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)).toBeNull()
  })

  it('preserves existing refresh token when new one is missing', async () => {
    mockRefreshConnectorOAuthToken.mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: undefined,
      tokenType: undefined,
      scope: undefined,
      expiresAt: '2026-06-01T00:00:00Z',
    })

    await refreshConnectorOAuthConfigIfNeeded(CONNECTOR)

    expect(mockBuildConfigWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        oauth: expect.objectContaining({
          refreshToken: 'refresh-1',
        }),
      }),
    )
  })
})
