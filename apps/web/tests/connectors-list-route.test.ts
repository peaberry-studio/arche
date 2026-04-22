import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDecryptConfig = vi.fn()
const mockGetRuntimeCapabilities = vi.fn()
const mockGetSession = vi.fn()
const mockIsDesktop = vi.fn(() => false)
const mockValidateDesktopToken = vi.fn(() => true)
const mockFindIdBySlug = vi.fn()
const mockFindManyByUserId = vi.fn()

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role },
    sessionId: 'session-1',
  }
}

async function loadRoute() {
  vi.doMock('@/lib/auth', () => ({
    auditEvent: vi.fn(),
  }))

  vi.doMock('@/lib/connectors/crypto', () => ({
    decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
    encryptConfig: vi.fn(),
  }))

  vi.doMock('@/lib/runtime/capabilities', () => ({
    getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
  }))

  vi.doMock('@/lib/runtime/desktop/token', () => ({
    DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
    validateDesktopToken: () => mockValidateDesktopToken(),
  }))

  vi.doMock('@/lib/runtime/mode', () => ({
    isDesktop: () => mockIsDesktop(),
  }))

  vi.doMock('@/lib/runtime/session', () => ({
    getSession: () => mockGetSession(),
  }))

  vi.doMock('@/lib/services', () => ({
    connectorService: {
      findManyByUserId: (...args: unknown[]) => mockFindManyByUserId(...args),
    },
    userService: {
      findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
    },
  }))

  return import('@/app/api/u/[slug]/connectors/route')
}

describe('GET /api/u/[slug]/connectors', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: true,
      auth: true,
      containers: true,
      workspaceAgent: true,
      reaper: true,
      connectors: true,
      csrf: true,
      teamManagement: true,
      kickstart: true,
      autopilot: true,
      slackIntegration: true,
      twoFactor: false,
    })
    mockGetSession.mockResolvedValue(session('alice'))
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockFindManyByUserId.mockResolvedValue([
      {
        id: 'linear-app',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        config: 'linear-app-config',
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
      },
      {
        id: 'linear-user',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        config: 'linear-user-config',
        createdAt: new Date('2026-04-21T10:05:00.000Z'),
      },
    ])
    mockDecryptConfig.mockImplementation((value: string) => {
      if (value === 'linear-app-config') {
        return {
          authType: 'oauth',
          oauthActor: 'app',
          oauth: { provider: 'linear', accessToken: 'app-token', clientId: 'client-app' },
        }
      }

      return {
        authType: 'oauth',
        oauth: { provider: 'linear', accessToken: 'user-token', clientId: 'client-user' },
      }
    })
  })

  it('exposes the resolved Linear OAuth actor mode in connector listings', async () => {
    const { GET } = await loadRoute()
    const response = await GET(new Request('http://localhost/api/u/alice/connectors') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      connectors: [
        {
          id: 'linear-app',
          type: 'linear',
          name: 'Linear',
          enabled: true,
          status: 'ready',
          authType: 'oauth',
          oauthActor: 'app',
          oauthConnected: true,
          oauthExpiresAt: undefined,
          createdAt: '2026-04-21T10:00:00.000Z',
        },
        {
          id: 'linear-user',
          type: 'linear',
          name: 'Linear',
          enabled: true,
          status: 'ready',
          authType: 'oauth',
          oauthActor: 'user',
          oauthConnected: true,
          oauthExpiresAt: undefined,
          createdAt: '2026-04-21T10:05:00.000Z',
        },
      ],
    })
  })
})
