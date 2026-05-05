import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false, connectors: true, metaAdsConnector: true })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  findIdBySlug: vi.fn(),
  findByIdAndUserId: vi.fn(),
  updateManyByIdAndUserId: vi.fn(),
  auditEvent: vi.fn(),
  decryptConfig: vi.fn(),
  encryptConfig: vi.fn(),
  clearConnectorOAuthConfig: vi.fn(),
  getConnectorAuthType: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  listMetaAdAccounts: vi.fn(),
  getPublicBaseUrl: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => mocks.auditEvent(...args),
}))
vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: (...args: unknown[]) => mocks.findIdBySlug(...args),
  },
  connectorService: {
    findByIdAndUserId: (...args: unknown[]) => mocks.findByIdAndUserId(...args),
    updateManyByIdAndUserId: (...args: unknown[]) => mocks.updateManyByIdAndUserId(...args),
  },
}))
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mocks.decryptConfig(...args),
  encryptConfig: (...args: unknown[]) => mocks.encryptConfig(...args),
}))
vi.mock('@/lib/connectors/oauth-config', () => ({
  clearConnectorOAuthConfig: (...args: unknown[]) => mocks.clearConnectorOAuthConfig(...args),
  getConnectorAuthType: (...args: unknown[]) => mocks.getConnectorAuthType(...args),
  getConnectorOAuthConfig: (...args: unknown[]) => mocks.getConnectorOAuthConfig(...args),
}))
vi.mock('@/lib/connectors/meta-ads', async () => {
  const config = await vi.importActual<typeof import('@/lib/connectors/meta-ads-config')>('@/lib/connectors/meta-ads-config')
  return {
    parseMetaAdsConnectorConfig: config.parseMetaAdsConnectorConfig,
    parseMetaAdsConnectorPermissions: config.parseMetaAdsConnectorPermissions,
    parseMetaAdsSelectedAdAccountIds: config.parseMetaAdsSelectedAdAccountIds,
    normalizeMetaAdsAccountId: config.normalizeMetaAdsAccountId,
    listMetaAdAccounts: (...args: unknown[]) => mocks.listMetaAdAccounts(...args),
  }
})
vi.mock('@/lib/http', () => ({
  getPublicBaseUrl: (...args: unknown[]) => mocks.getPublicBaseUrl(...args),
}))

import { GET, PATCH } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'ADMIN' },
  sessionId: 's1',
}

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), init)
}

function idParams(slug = 'alice', id = 'conn-1') {
  return { params: Promise.resolve({ slug, id }) }
}

const VALID_CONFIG = {
  authType: 'oauth',
  appId: 'app-123',
  appSecret: 'secret-123',
  permissions: { allowRead: true, allowWrite: false, allowCampaignManagement: false },
  selectedAdAccountIds: ['act_123'],
  defaultAdAccountId: 'act_123',
}

describe('GET /api/u/[slug]/connectors/[id]/meta-ads-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.findByIdAndUserId.mockResolvedValue({
      id: 'conn-1',
      userId: 'u1',
      type: 'meta-ads',
      config: 'encrypted-config',
    })
    mocks.decryptConfig.mockReturnValue(VALID_CONFIG)
    mocks.getConnectorOAuthConfig.mockReturnValue({
      accessToken: 'oauth-token',
      provider: 'meta-ads',
      clientId: 'app-123',
    })
    mocks.getPublicBaseUrl.mockReturnValue('https://arche.example.com')
    mocks.listMetaAdAccounts.mockResolvedValue({
      ok: true,
      data: { items: [{ id: 'act_123', name: 'Test Account' }] },
    })
  })

  it('returns settings for a valid meta-ads connector', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.appId).toBe('app-123')
    expect(body.hasAppSecret).toBe(true)
    expect(body.permissions.allowRead).toBe(true)
    expect(body.oauthConnected).toBe(true)
    expect(body.selectedAdAccountIds).toEqual(['act_123'])
    expect(body.defaultAdAccountId).toBe('act_123')
    expect(body.adAccounts).toEqual([{ id: 'act_123', name: 'Test Account' }])
    expect(body.redirectUri).toBe('https://arche.example.com/api/connectors/oauth/callback')
  })

  it('returns 404 when user not found', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'user_not_found' })
  })

  it('returns 404 when connector not found', async () => {
    mocks.findByIdAndUserId.mockResolvedValue(null)
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'connector_not_found' })
  })

  it('returns 400 for unsupported connector type', async () => {
    mocks.findByIdAndUserId.mockResolvedValue({
      id: 'conn-1',
      userId: 'u1',
      type: 'notion',
      config: 'encrypted-config',
    })
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unsupported_connector' })
  })

  it('returns 500 when config decryption fails', async () => {
    mocks.decryptConfig.mockImplementation(() => {
      throw new Error('decrypt failed')
    })
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'config_corrupted',
      message: 'Failed to decrypt connector configuration',
    })
  })

  it('returns 500 when connector config is invalid', async () => {
    mocks.decryptConfig.mockReturnValue({ authType: 'oauth', appId: '', appSecret: '' })
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
  })

  it('returns 403 when connectors capability is disabled', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false, connectors: false, metaAdsConnector: true })
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 when metaAdsConnector capability is disabled', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false, connectors: true, metaAdsConnector: false })
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings'),
      idParams(),
    )
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/u/[slug]/connectors/[id]/meta-ads-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false, connectors: true, metaAdsConnector: true })
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.findByIdAndUserId.mockResolvedValue({
      id: 'conn-1',
      userId: 'u1',
      type: 'meta-ads',
      config: 'encrypted-config',
    })
    mocks.decryptConfig.mockReturnValue(VALID_CONFIG)
    mocks.encryptConfig.mockReturnValue('encrypted-updated')
    mocks.getConnectorAuthType.mockReturnValue('oauth')
    mocks.getConnectorOAuthConfig.mockReturnValue(null)
    mocks.clearConnectorOAuthConfig.mockImplementation((cfg: Record<string, unknown>) => ({
      ...cfg,
      authType: 'oauth',
    }))
    mocks.getPublicBaseUrl.mockReturnValue('https://arche.example.com')
    mocks.listMetaAdAccounts.mockResolvedValue({
      ok: true,
      data: { items: [{ id: 'act_123', name: 'Test Account' }] },
    })
    mocks.updateManyByIdAndUserId.mockResolvedValue({ count: 1 })
    mocks.auditEvent.mockResolvedValue(undefined)
  })

  it('updates settings successfully', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'app-456' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.appId).toBe('app-456')
    expect(mocks.updateManyByIdAndUserId).toHaveBeenCalledWith('conn-1', 'u1', {
      config: 'encrypted-updated',
    })
    expect(mocks.auditEvent).toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{bad json',
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_json' })
  })

  it('returns 400 when body is not an object', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([1, 2, 3]),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_body',
      message: 'Request body must be a JSON object',
    })
  })

  it('returns 400 when appId is missing', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: '' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_app_id', message: 'App ID is required.' })
  })

  it('returns 400 for invalid appSecret type', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appSecret: 123 }),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_app_secret',
      message: 'App Secret must be a string.',
    })
  })

  it('returns 400 for invalid permissions', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissions: { allowRead: 'yes' } }),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_permissions',
      message: 'allowRead must be a boolean',
    })
  })

  it('returns 400 for invalid selectedAdAccountIds', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectedAdAccountIds: ['invalid'] }),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_ad_accounts',
      message: 'Invalid ad account id: invalid',
    })
  })

  it('returns 400 for invalid defaultAdAccountId type', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultAdAccountId: 123 }),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_default_ad_account',
      message: 'Default ad account must be a string or null.',
    })
  })

  it('returns 400 when defaultAdAccountId is not in selected accounts', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultAdAccountId: 'act_999' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_default_ad_account',
      message: 'Default ad account must match one of the selected ad accounts.',
    })
  })

  it('clears OAuth config when credentials change', async () => {
    mocks.clearConnectorOAuthConfig.mockReturnValue({ authType: 'oauth' })
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'new-app' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(200)
    expect(mocks.clearConnectorOAuthConfig).toHaveBeenCalled()
    expect(mocks.updateManyByIdAndUserId).toHaveBeenCalledWith('conn-1', 'u1', {
      config: 'encrypted-updated',
    })
  })

  it('returns 500 when config decryption fails', async () => {
    mocks.decryptConfig.mockImplementation(() => {
      throw new Error('decrypt failed')
    })
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'app-456' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'config_corrupted',
      message: 'Failed to decrypt connector configuration',
    })
  })

  it('returns 500 when existing config is invalid', async () => {
    mocks.decryptConfig.mockReturnValue({ authType: 'oauth', appId: '', appSecret: '' })
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'app-456' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
  })

  it('returns 400 when encryption fails', async () => {
    mocks.encryptConfig.mockImplementation(() => {
      throw new Error('encryption failed')
    })
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'app-456' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_config',
      message: 'encryption failed',
    })
  })

  it('returns 404 when update affects 0 rows', async () => {
    mocks.updateManyByIdAndUserId.mockResolvedValue({ count: 0 })
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'app-456' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'connector_not_found' })
  })

  it('returns 404 when user not found', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'app-456' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'user_not_found' })
  })

  it('returns 404 when connector not found', async () => {
    mocks.findByIdAndUserId.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1/meta-ads-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: 'app-456' }),
      }),
      idParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'connector_not_found' })
  })
})
