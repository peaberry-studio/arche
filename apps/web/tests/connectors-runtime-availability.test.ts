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

const mockFindIdBySlug = vi.fn()
const mockCreate = vi.fn()
const mockFindFirstByUserIdAndType = vi.fn()
const mockFindManyByUserId = vi.fn()
vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
  },
  connectorService: {
    create: (...args: unknown[]) => mockCreate(...args),
    findFirstByUserIdAndType: (...args: unknown[]) => mockFindFirstByUserIdAndType(...args),
    findManyByUserId: (...args: unknown[]) => mockFindManyByUserId(...args),
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
    mockFindFirstByUserIdAndType.mockResolvedValue(null)
    mockEncryptConfig.mockReturnValue('encrypted-config')
    mockCreate.mockResolvedValue({
      id: 'conn-meta-1',
      type: 'meta-ads',
      name: 'Meta Ads',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('lists Meta Ads connectors in desktop mode', async () => {
    mockFindManyByUserId.mockResolvedValue([
      {
        id: 'conn-meta-1',
        type: 'meta-ads',
        name: 'Meta Ads',
        enabled: true,
        config: 'encrypted-config',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    mockDecryptConfig.mockReturnValue({
      authType: 'oauth',
      appId: 'meta-app-id',
      appSecret: 'meta-app-secret',
      selectedAdAccountIds: ['act_123'],
      permissions: { allowRead: true },
      oauth: { provider: 'meta-ads', accessToken: 'meta-token' },
    })

    const { GET } = await import('@/app/api/u/[slug]/connectors/route')
    const request = new Request('http://localhost/api/u/local/connectors', {
      headers: desktopHeaders(),
    })

    const response = await GET(request as never, { params: Promise.resolve({ slug: 'local' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      connectors: [{ id: 'conn-meta-1', type: 'meta-ads' }],
    })
  })

  it('allows creating Meta Ads connectors in desktop mode', async () => {
    const { POST } = await import('@/app/api/u/[slug]/connectors/route')
    const request = new Request('http://localhost/api/u/local/connectors', {
      method: 'POST',
      headers: desktopHeaders({ 'content-type': 'application/json' }),
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

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith({
      userId: 'local',
      type: 'meta-ads',
      name: 'Meta Ads',
      config: 'encrypted-config',
      enabled: true,
    })
  })
})
