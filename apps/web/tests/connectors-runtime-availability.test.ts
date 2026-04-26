import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
vi.mock('@/lib/runtime/session', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
}))

const mockDecryptConfig = vi.fn()
const mockEncryptConfig = vi.fn()
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
  encryptConfig: (...args: unknown[]) => mockEncryptConfig(...args),
}))

const mockRefreshConnectorOAuthConfigIfNeeded = vi.fn()
vi.mock('@/lib/connectors/oauth-refresh', () => ({
  refreshConnectorOAuthConfigIfNeeded: (...args: unknown[]) =>
    mockRefreshConnectorOAuthConfigIfNeeded(...args),
}))

const mockFindIdBySlug = vi.fn()
const mockCreate = vi.fn()
const mockFindByIdAndUserId = vi.fn()
const mockFindByIdAndUserIdSelect = vi.fn()
vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
  },
  connectorService: {
    create: (...args: unknown[]) => mockCreate(...args),
    findByIdAndUserId: (...args: unknown[]) => mockFindByIdAndUserId(...args),
    findByIdAndUserIdSelect: (...args: unknown[]) => mockFindByIdAndUserIdSelect(...args),
  },
}))

const originalEnv = process.env

function desktopHeaders(overrides?: Record<string, string>): HeadersInit {
  return {
    host: 'localhost',
    'x-arche-desktop-token': 'desktop-token',
    ...overrides,
  }
}

describe('desktop connector availability routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = {
      ...originalEnv,
      ARCHE_RUNTIME_MODE: 'desktop',
      ARCHE_DESKTOP_PLATFORM: 'darwin',
      ARCHE_DESKTOP_WEB_HOST: '127.0.0.1',
      ARCHE_DESKTOP_API_TOKEN: 'desktop-token',
    }

    mockGetSession.mockResolvedValue({
      user: { id: 'local', email: 'local@arche.local', slug: 'local', role: 'ADMIN' },
      sessionId: 'desktop-session',
    })
    mockFindIdBySlug.mockResolvedValue({ id: 'local' })
    mockCreate.mockResolvedValue(null)
    mockFindByIdAndUserId.mockResolvedValue({
      id: 'conn-meta-1',
      type: 'meta-ads',
      config: 'encrypted-config',
      enabled: true,
      userId: 'local',
    })
    mockFindByIdAndUserIdSelect.mockResolvedValue({
      id: 'conn-meta-1',
      type: 'meta-ads',
      config: 'encrypted-config',
    })
    mockRefreshConnectorOAuthConfigIfNeeded.mockResolvedValue(null)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('blocks creating Meta Ads connectors in desktop mode', async () => {
    const { POST } = await import('@/app/api/u/[slug]/connectors/route')
    const request = new Request('http://localhost/api/u/local/connectors', {
      method: 'POST',
      headers: {
        ...desktopHeaders({ 'content-type': 'application/json' }),
      },
      body: JSON.stringify({
        type: 'meta-ads',
        name: 'Meta Ads',
        config: {
          authType: 'oauth',
          appId: 'meta-app-id',
          appSecret: 'meta-app-secret',
        },
      }),
    })

    const response = await POST(request as never, { params: Promise.resolve({ slug: 'local' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'metaAdsConnector is not available in this runtime mode',
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('blocks Meta Ads settings routes in desktop mode before decrypting config', async () => {
    const { GET } = await import('@/app/api/u/[slug]/connectors/[id]/meta-ads-settings/route')
    const request = new Request('http://localhost/api/u/local/connectors/conn-meta-1/meta-ads-settings', {
      method: 'GET',
      headers: desktopHeaders(),
    })

    const response = await GET(request as never, { params: Promise.resolve({ slug: 'local', id: 'conn-meta-1' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'metaAdsConnector is not available in this runtime mode',
    })
    expect(mockDecryptConfig).not.toHaveBeenCalled()
  })

  it('blocks testing Meta Ads connectors in desktop mode before refreshing OAuth', async () => {
    const { POST } = await import('@/app/api/u/[slug]/connectors/[id]/test/route')
    const request = new Request('http://localhost/api/u/local/connectors/conn-meta-1/test', {
      method: 'POST',
      headers: desktopHeaders(),
    })

    const response = await POST(request as never, { params: Promise.resolve({ slug: 'local', id: 'conn-meta-1' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'metaAdsConnector is not available in this runtime mode',
    })
    expect(mockRefreshConnectorOAuthConfigIfNeeded).not.toHaveBeenCalled()
  })

  it('blocks starting Meta Ads OAuth in desktop mode before decrypting config', async () => {
    const { POST } = await import('@/app/api/u/[slug]/connectors/[id]/oauth/start/route')
    const request = {
      headers: new Headers(desktopHeaders()),
      nextUrl: new URL('http://localhost/api/u/local/connectors/conn-meta-1/oauth/start'),
    }

    const response = await POST(request as never, { params: Promise.resolve({ slug: 'local', id: 'conn-meta-1' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'metaAdsConnector is not available in this runtime mode',
    })
    expect(mockDecryptConfig).not.toHaveBeenCalled()
    expect(mockAuditEvent).not.toHaveBeenCalled()
  })
})
