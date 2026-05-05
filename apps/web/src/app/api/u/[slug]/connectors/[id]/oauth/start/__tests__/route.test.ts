import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false, connectors: true, metaAdsConnector: true })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  findIdBySlug: vi.fn(),
  findByIdAndUserIdSelect: vi.fn(),
  getPublicBaseUrl: vi.fn(),
  normalizeConnectorOAuthReturnTo: vi.fn(),
  decryptConfig: vi.fn(),
  getResolvedCredentials: vi.fn(),
  prepareConnectorOAuthAuthorization: vi.fn(),
  auditEvent: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: (...args: unknown[]) => mocks.findIdBySlug(...args),
  },
  connectorService: {
    findByIdAndUserIdSelect: (...args: unknown[]) => mocks.findByIdAndUserIdSelect(...args),
  },
  googleWorkspaceService: {
    getResolvedCredentials: (...args: unknown[]) => mocks.getResolvedCredentials(...args),
  },
}))
vi.mock('@/lib/http', () => ({
  getPublicBaseUrl: (...args: unknown[]) => mocks.getPublicBaseUrl(...args),
}))
vi.mock('@/lib/connectors/oauth', () => ({
  isOAuthConnectorType: (type: string) =>
    ['linear', 'notion', 'meta-ads', 'google-calendar', 'google-drive', 'custom'].includes(type),
  normalizeConnectorOAuthReturnTo: (...args: unknown[]) => mocks.normalizeConnectorOAuthReturnTo(...args),
  prepareConnectorOAuthAuthorization: (...args: unknown[]) => mocks.prepareConnectorOAuthAuthorization(...args),
}))
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mocks.decryptConfig(...args),
}))
vi.mock('@/lib/connectors/validators', () => ({
  validateConnectorType: (type: string) =>
    ['linear', 'notion', 'meta-ads', 'google-calendar', 'google-drive', 'custom', 'zendesk', 'ahrefs', 'umami'].includes(
      type,
    ),
}))
vi.mock('@/lib/connectors/google-workspace', () => ({
  isGoogleWorkspaceConnectorType: (type: string) => ['google-calendar', 'google-drive'].includes(type),
}))
vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => mocks.auditEvent(...args),
}))

import { POST } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'ADMIN' },
  sessionId: 's1',
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'POST' })
}

function idParams(slug = 'alice', id = 'conn-1') {
  return { params: Promise.resolve({ slug, id }) }
}

describe('POST /api/u/[slug]/connectors/[id]/oauth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false, connectors: true, metaAdsConnector: true })
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'linear',
      config: 'encrypted-config',
    })
    mocks.getPublicBaseUrl.mockReturnValue('https://arche.example.com')
    mocks.normalizeConnectorOAuthReturnTo.mockReturnValue(undefined)
    mocks.decryptConfig.mockReturnValue({ clientId: 'client-1', clientSecret: 'secret-1' })
    mocks.getResolvedCredentials.mockResolvedValue(null)
    mocks.prepareConnectorOAuthAuthorization.mockResolvedValue({ authorizeUrl: 'https://linear.app/oauth/authorize' })
    mocks.auditEvent.mockResolvedValue(undefined)
  })

  it('starts OAuth for a linear connector', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authorizeUrl).toBe('https://linear.app/oauth/authorize')
    expect(mocks.auditEvent).toHaveBeenCalledWith({
      actorUserId: 'u1',
      action: 'connector.oauth_started',
      metadata: { connectorId: 'conn-1', connectorType: 'linear' },
    })
  })

  it('returns 404 when user not found', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'user_not_found' })
  })

  it('returns 404 when connector not found', async () => {
    mocks.findByIdAndUserIdSelect.mockResolvedValue(null)
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'connector_not_found' })
  })

  it('returns 400 when connector does not support OAuth', async () => {
    mocks.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'zendesk',
      config: 'encrypted-config',
    })
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'oauth_not_supported' })
  })

  it('returns 400 for invalid connector type', async () => {
    mocks.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'bogus',
      config: 'encrypted-config',
    })
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'oauth_not_supported' })
  })

  it('returns 403 when meta-ads capability is disabled', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false, connectors: true, metaAdsConnector: false })
    mocks.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'meta-ads',
      config: 'encrypted-config',
    })
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(403)
  })

  it('returns 500 when config decryption fails for linear', async () => {
    mocks.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'linear',
      config: 'encrypted-config',
    })
    mocks.decryptConfig.mockImplementation(() => {
      throw new Error('decrypt failed')
    })
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'config_corrupted',
      message: 'Failed to decrypt connector configuration',
    })
  })

  it('returns 500 when config decryption fails for meta-ads', async () => {
    mocks.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'meta-ads',
      config: 'encrypted-config',
    })
    mocks.decryptConfig.mockImplementation(() => {
      throw new Error('decrypt failed')
    })
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'config_corrupted',
      message: 'Failed to decrypt connector configuration',
    })
  })

  it('returns 400 for missing_endpoint error', async () => {
    mocks.prepareConnectorOAuthAuthorization.mockRejectedValue(new Error('missing_endpoint'))
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing_endpoint' })
  })

  it('returns 400 for meta_ads_missing_app_id error', async () => {
    mocks.prepareConnectorOAuthAuthorization.mockRejectedValue(new Error('meta_ads_missing_app_id'))
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'meta_ads_missing_app_id',
      message: 'Meta Ads App ID is required before connecting OAuth.',
    })
  })

  it('returns 400 for meta_ads_missing_app_secret error', async () => {
    mocks.prepareConnectorOAuthAuthorization.mockRejectedValue(new Error('meta_ads_missing_app_secret'))
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'meta_ads_missing_app_secret',
      message: 'Meta Ads App Secret is required before connecting OAuth.',
    })
  })

  it('returns 502 for oauth_discovery_failed', async () => {
    mocks.prepareConnectorOAuthAuthorization.mockRejectedValue(new Error('oauth_discovery_failed:network'))
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'oauth_discovery_failed',
      message: 'Failed to discover OAuth endpoints for this MCP server.',
    })
  })

  it('returns 502 for oauth_registration_failed', async () => {
    mocks.prepareConnectorOAuthAuthorization.mockRejectedValue(new Error('oauth_registration_failed:500'))
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'oauth_registration_failed',
      message: 'Dynamic client registration failed for this MCP server.',
    })
  })

  it('returns 500 for unexpected oauth start errors', async () => {
    mocks.prepareConnectorOAuthAuthorization.mockRejectedValue(new Error('unexpected_error'))
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'unexpected_error' })
  })

  it('merges google workspace admin credentials', async () => {
    mocks.findByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-1',
      type: 'google-calendar',
      config: 'encrypted-config',
    })
    mocks.getResolvedCredentials.mockResolvedValue({ clientId: 'admin-client', clientSecret: 'admin-secret' })
    mocks.decryptConfig.mockReturnValue({ clientId: 'old-client' })
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(200)
    expect(mocks.prepareConnectorOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorConfig: { clientId: 'admin-client', clientSecret: 'admin-secret' },
      }),
    )
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/oauth/start'),
      idParams(),
    )
    expect(res.status).toBe(401)
  })
})
