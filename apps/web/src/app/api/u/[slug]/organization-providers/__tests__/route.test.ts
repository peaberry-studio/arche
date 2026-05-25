import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  getSession: vi.fn(),
  isDesktop: vi.fn(() => false),
  providerService: {
    findOrganizationCredentialsByProviders: vi.fn(),
  },
  validateDesktopToken: vi.fn(() => true),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
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
  providerService: mocks.providerService,
}))

import { GET } from '../route'

const ADMIN_SESSION = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 'session-1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/u/admin/organization-providers', { method: 'GET' })
}

function routeParams(slug = 'admin') {
  return { params: Promise.resolve({ slug }) }
}

describe('GET /api/u/[slug]/organization-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.isDesktop.mockReturnValue(false)
    mocks.providerService.findOrganizationCredentialsByProviders.mockResolvedValue([])
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
  })

  it('returns organization provider summaries for admins', async () => {
    mocks.providerService.findOrganizationCredentialsByProviders.mockResolvedValue([
      {
        id: 'cred-openai-current',
        lastUsedAt: new Date('2026-05-01T12:00:00.000Z'),
        providerId: 'openai',
        status: 'enabled',
        type: 'api',
        version: 3,
      },
      {
        id: 'cred-openai-old',
        lastUsedAt: null,
        providerId: 'openai',
        status: 'disabled',
        type: 'api',
        version: 1,
      },
      {
        id: 'cred-anthropic',
        lastUsedAt: null,
        providerId: 'anthropic',
        status: 'disabled',
        type: 'api',
        version: 2,
      },
    ])

    const response = await GET(makeRequest(), routeParams())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.providerService.findOrganizationCredentialsByProviders).toHaveBeenCalledWith([
      'openai',
      'anthropic',
      'fireworks',
      'openrouter',
      'opencode',
    ])
    expect(body.providers).toHaveLength(5)
    expect(body.providers.find((provider: { providerId: string }) => provider.providerId === 'openai')).toEqual({
      id: 'cred-openai-current',
      lastUsedAt: '2026-05-01T12:00:00.000Z',
      providerId: 'openai',
      status: 'enabled',
      type: 'api',
      version: 3,
    })
    expect(body.providers.find((provider: { providerId: string }) => provider.providerId === 'anthropic')).toEqual({
      id: 'cred-anthropic',
      lastUsedAt: null,
      providerId: 'anthropic',
      status: 'disabled',
      type: 'api',
      version: 2,
    })
    expect(body.providers.find((provider: { providerId: string }) => provider.providerId === 'fireworks')).toEqual({
      providerId: 'fireworks',
      status: 'missing',
    })
  })

  it('returns 403 for non-admin users', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@test.com', slug: 'admin', role: 'USER' },
      sessionId: 'session-2',
    })

    const response = await GET(makeRequest(), routeParams())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(mocks.providerService.findOrganizationCredentialsByProviders).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await GET(makeRequest(), routeParams())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })
})
