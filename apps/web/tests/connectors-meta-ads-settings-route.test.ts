import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
}))

const mockValidateSameOrigin = vi.fn()
vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: (...args: unknown[]) => mockValidateSameOrigin(...args),
}))

const mockDecryptConfig = vi.fn()
const mockEncryptConfig = vi.fn()
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
  encryptConfig: (...args: unknown[]) => mockEncryptConfig(...args),
}))

const mockFindIdBySlug = vi.fn()
const mockFindByIdAndUserId = vi.fn()
const mockUpdateManyByIdAndUserId = vi.fn()
vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
  },
  connectorService: {
    findByIdAndUserId: (...args: unknown[]) => mockFindByIdAndUserId(...args),
    updateManyByIdAndUserId: (...args: unknown[]) => mockUpdateManyByIdAndUserId(...args),
  },
}))

function session(slug: string) {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role: 'USER' },
    sessionId: 'session-1',
  }
}

async function callGetRoute(slug = 'alice', id = 'conn-meta-1') {
  const { GET } = await import('@/app/api/u/[slug]/connectors/[id]/meta-ads-settings/route')
  const request = new Request(`http://localhost/api/u/${slug}/connectors/${id}/meta-ads-settings`, {
    method: 'GET',
    headers: { host: 'localhost' },
  })

  const response = await GET(request as never, { params: Promise.resolve({ slug, id }) })
  return { status: response.status, body: await response.json() }
}

async function callPatchRoute(body: unknown, slug = 'alice', id = 'conn-meta-1') {
  const { PATCH } = await import('@/app/api/u/[slug]/connectors/[id]/meta-ads-settings/route')
  const request = new Request(`http://localhost/api/u/${slug}/connectors/${id}/meta-ads-settings`, {
    method: 'PATCH',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const response = await PATCH(request as never, { params: Promise.resolve({ slug, id }) })
  return { status: response.status, body: await response.json() }
}

describe('Meta Ads connector settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockFindByIdAndUserId.mockResolvedValue({
      id: 'conn-meta-1',
      userId: 'user-1',
      type: 'meta-ads',
      name: 'Meta Ads',
      config: 'encrypted-config',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    mockDecryptConfig.mockReturnValue({
      authType: 'oauth',
      appId: 'meta-app-id',
      appSecret: 'meta-app-secret',
      permissions: {
        allowRead: true,
        allowWriteCampaigns: false,
        allowWriteAdSets: false,
        allowWriteAds: false,
      },
      selectedAdAccountIds: ['act_123'],
      defaultAdAccountId: 'act_123',
      oauth: {
        provider: 'meta-ads',
        accessToken: 'meta-token',
        clientId: 'meta-app-id',
        expiresAt: '2026-02-01T00:00:00.000Z',
      },
    })
    mockEncryptConfig.mockReturnValue('encrypted-updated-config')
    mockUpdateManyByIdAndUserId.mockResolvedValue({ count: 1 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          { id: 'act_123', account_id: '123', name: 'Main account', currency: 'EUR' },
          { id: 'act_456', account_id: '456', name: 'Backup account', currency: 'USD' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))
  })

  it('returns sanitized Meta Ads settings and accessible ad accounts', async () => {
    const { status, body } = await callGetRoute()

    expect(status).toBe(200)
    expect(body).toEqual({
      appId: 'meta-app-id',
      hasAppSecret: true,
      permissions: {
        allowRead: true,
        allowWriteCampaigns: false,
        allowWriteAdSets: false,
        allowWriteAds: false,
      },
      oauthConnected: true,
      oauthExpiresAt: '2026-02-01T00:00:00.000Z',
      selectedAdAccountIds: ['act_123'],
      defaultAdAccountId: 'act_123',
      adAccounts: [
        { id: 'act_123', accountId: '123', name: 'Main account', accountStatus: undefined, currency: 'EUR', timezoneName: undefined },
        { id: 'act_456', accountId: '456', name: 'Backup account', accountStatus: undefined, currency: 'USD', timezoneName: undefined },
      ],
      adAccountsError: undefined,
      redirectUri: 'http://localhost/api/connectors/oauth/callback',
    })
  })

  it('returns ad account lookup errors without failing the settings response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: 190,
          message: 'Token expired',
        },
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    ))

    const { status, body } = await callGetRoute()

    expect(status).toBe(200)
    expect(body).toMatchObject({
      oauthConnected: true,
      selectedAdAccountIds: ['act_123'],
      adAccounts: [],
      adAccountsError: 'Token expired',
    })
  })

  it('clears OAuth state and selected accounts when app credentials change', async () => {
    const { status, body } = await callPatchRoute({
      appId: 'meta-app-id-2',
      permissions: {
        allowRead: true,
        allowWriteCampaigns: false,
        allowWriteAdSets: false,
        allowWriteAds: false,
      },
      selectedAdAccountIds: ['act_456'],
      defaultAdAccountId: 'act_456',
    })

    expect(status).toBe(200)
    expect(body).toMatchObject({
      appId: 'meta-app-id-2',
      oauthConnected: false,
      selectedAdAccountIds: [],
      adAccounts: [],
    })
    expect(mockEncryptConfig).toHaveBeenCalledWith({
      authType: 'oauth',
      appId: 'meta-app-id-2',
      appSecret: 'meta-app-secret',
      permissions: {
        allowRead: true,
        allowWriteCampaigns: false,
        allowWriteAdSets: false,
        allowWriteAds: false,
      },
      selectedAdAccountIds: [],
      defaultAdAccountId: undefined,
    })
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'connector.meta_ads_settings_updated',
      metadata: {
        connectorId: 'conn-meta-1',
        credentialsChanged: true,
        allowRead: true,
        selectedAdAccountCount: 0,
      },
    })
  })

  it('rejects a default ad account outside the selected set', async () => {
    const { status, body } = await callPatchRoute({
      selectedAdAccountIds: ['act_123'],
      defaultAdAccountId: 'act_999',
    })

    expect(status).toBe(400)
    expect(body).toEqual({
      error: 'invalid_default_ad_account',
      message: 'Default ad account must match one of the selected ad accounts.',
    })
    expect(mockEncryptConfig).not.toHaveBeenCalled()
    expect(mockUpdateManyByIdAndUserId).not.toHaveBeenCalled()
    expect(mockAuditEvent).not.toHaveBeenCalled()
  })
})
