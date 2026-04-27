import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  auditEvent: vi.fn(),
  decryptConfig: vi.fn(),
  encryptConfig: vi.fn(),
  exchangeConnectorOAuthCode: vi.fn(),
  isOAuthConnectorType: vi.fn(() => true),
  normalizeConnectorOAuthReturnTo: vi.fn(() => null),
  verifyConnectorOAuthState: vi.fn(),
  buildConfigWithOAuth: vi.fn(),
  validateConnectorType: vi.fn(() => true),
  getPublicBaseUrl: vi.fn(() => 'http://localhost'),
  getCurrentDesktopVault: vi.fn(() => null),
  getDesktopWorkspaceHref: vi.fn(),
  connectorService: {
    findByIdAndUserIdSelect: vi.fn(),
    updateByIdUnsafe: vi.fn(),
  },
}))

vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: mocks.decryptConfig,
  encryptConfig: mocks.encryptConfig,
}))
vi.mock('@/lib/connectors/oauth', () => ({
  exchangeConnectorOAuthCode: mocks.exchangeConnectorOAuthCode,
  isOAuthConnectorType: mocks.isOAuthConnectorType,
  normalizeConnectorOAuthReturnTo: mocks.normalizeConnectorOAuthReturnTo,
  verifyConnectorOAuthState: mocks.verifyConnectorOAuthState,
}))
vi.mock('@/lib/connectors/oauth-config', () => ({
  buildConfigWithOAuth: mocks.buildConfigWithOAuth,
}))
vi.mock('@/lib/connectors/validators', () => ({
  validateConnectorType: mocks.validateConnectorType,
}))
vi.mock('@/lib/http', () => ({
  getPublicBaseUrl: mocks.getPublicBaseUrl,
}))
vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: mocks.getCurrentDesktopVault,
  getDesktopWorkspaceHref: mocks.getDesktopWorkspaceHref,
}))
vi.mock('@/lib/services', () => ({
  connectorService: mocks.connectorService,
}))

import { GET } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

const PARSED_STATE = {
  connectorId: 'c1',
  connectorType: 'linear',
  userId: 'u1',
  slug: 'admin',
  clientId: 'cid',
  clientSecret: 'csec',
  codeVerifier: 'verifier',
  tokenEndpoint: 'https://auth/token',
  authorizationEndpoint: 'https://auth/authorize',
  registrationEndpoint: undefined,
  issuer: undefined,
  mcpServerUrl: undefined,
  redirectUri: undefined,
  returnTo: undefined,
}

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/connectors/oauth/callback')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url, { method: 'GET' })
}

describe('GET /api/connectors/oauth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.verifyConnectorOAuthState.mockReturnValue(PARSED_STATE)
    mocks.connectorService.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'c1',
      type: 'linear',
      config: 'encrypted',
    })
    mocks.decryptConfig.mockReturnValue({ apiKey: 'old' })
    mocks.buildConfigWithOAuth.mockReturnValue({ oauth: 'new-config' })
    mocks.encryptConfig.mockReturnValue('new-encrypted')
    mocks.exchangeConnectorOAuthCode.mockResolvedValue({
      accessToken: 'at',
      refreshToken: 'rt',
      tokenType: 'bearer',
      scope: 'read',
      expiresAt: '2026-06-01T00:00:00Z',
    })
  })

  it('redirects to success after completing exchange', async () => {
    const res = await GET(makeRequest({ code: 'auth-code', state: 'encoded-state' }))
    expect(res.status).toBe(307)
    const location = res.headers.get('location')!
    expect(location).toContain('oauth=success')
    expect(mocks.connectorService.updateByIdUnsafe).toHaveBeenCalled()
    expect(mocks.auditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connector.oauth_connected' }),
    )
  })

  it('returns 400 when state is missing', async () => {
    const res = await GET(makeRequest({ code: 'auth-code' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when state is invalid', async () => {
    mocks.verifyConnectorOAuthState.mockImplementation(() => {
      throw new Error('invalid_state')
    })
    const res = await GET(makeRequest({ state: 'bad' }))
    expect(res.status).toBe(400)
  })

  it('redirects with unauthorized when no session', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await GET(makeRequest({ code: 'c', state: 's' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('unauthorized')
  })

  it('redirects with forbidden when user slug mismatch and not admin', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'u2', email: 'user@test.com', slug: 'other', role: 'USER' },
      sessionId: 's1',
    })
    const res = await GET(makeRequest({ code: 'c', state: 's' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('forbidden')
  })

  it('redirects with provider error when error param present', async () => {
    const res = await GET(makeRequest({ state: 's', error: 'access_denied' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('access_denied')
    expect(mocks.auditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connector.oauth_failed' }),
    )
  })

  it('normalizes unknown provider errors', async () => {
    const res = await GET(makeRequest({ state: 's', error: 'some_custom_error' }))
    expect(res.headers.get('location')).toContain('oauth_failed')
  })

  it('redirects with missing_code when code is absent', async () => {
    const res = await GET(makeRequest({ state: 's' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('missing_code')
  })

  it('redirects with connector_not_found when connector missing', async () => {
    mocks.connectorService.findByIdAndUserIdSelect.mockResolvedValue(null)
    const res = await GET(makeRequest({ code: 'c', state: 's' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('connector_not_found')
  })

  it('redirects with invalid_state when clientId is missing', async () => {
    mocks.verifyConnectorOAuthState.mockReturnValue({
      ...PARSED_STATE,
      clientId: undefined,
    })
    const res = await GET(makeRequest({ code: 'c', state: 's' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('invalid_state')
  })

  it('redirects with oauth_failed on exchange error', async () => {
    mocks.exchangeConnectorOAuthCode.mockRejectedValue(new Error('token exchange failed'))
    const res = await GET(makeRequest({ code: 'c', state: 's' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('oauth_failed')
  })
})
