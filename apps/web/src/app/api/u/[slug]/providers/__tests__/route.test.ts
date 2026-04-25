import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  providerService: { findCredentialsByUserAndProviders: vi.fn() },
  userService: { findIdBySlug: vi.fn() },
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
  userService: mocks.userService,
}))

import { GET } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/u/admin/providers', { method: 'GET' })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('GET /api/u/[slug]/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.providerService.findCredentialsByUserAndProviders.mockResolvedValue([])
  })

  it('returns providers list with missing status when no credentials', async () => {
    const res = await GET(makeRequest(), params('admin'))
    const body = await res.json()
    expect(body.providers).toBeDefined()
    expect(body.providers.length).toBeGreaterThan(0)
    expect(body.providers.every((p: { status: string }) => p.status === 'missing')).toBe(true)
  })

  it('returns enabled status for configured provider', async () => {
    mocks.providerService.findCredentialsByUserAndProviders.mockResolvedValue([
      { providerId: 'anthropic', status: 'enabled', type: 'api_key', version: 1 },
    ])

    const res = await GET(makeRequest(), params('admin'))
    const body = await res.json()
    const anthropic = body.providers.find((p: { providerId: string }) => p.providerId === 'anthropic')
    expect(anthropic.status).toBe('enabled')
    expect(anthropic.type).toBe('api_key')
  })

  it('returns 404 when user not found', async () => {
    mocks.userService.findIdBySlug.mockResolvedValue(null)
    const res = await GET(makeRequest(), params('admin'))
    expect(res.status).toBe(404)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await GET(makeRequest(), params('admin'))
    expect(res.status).toBe(401)
  })
})
