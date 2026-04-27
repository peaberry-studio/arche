import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  instanceService: {
    findBySlug: vi.fn(),
    touchActivity: vi.fn(),
  },
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/services', () => ({ instanceService: mocks.instanceService }))

import { PATCH } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

const originalEnv = { ...process.env }

function makeRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/instances/alice/activity', {
    method: 'PATCH',
    headers: { Origin: 'http://localhost', ...headers },
  })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('PATCH /api/instances/[slug]/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.instanceService.findBySlug.mockResolvedValue({
      slug: 'alice',
      lastActivityAt: new Date(Date.now() - 60_000),
    })
    mocks.instanceService.touchActivity.mockResolvedValue(undefined)
    delete process.env.ARCHE_INTERNAL_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('touches activity on success', async () => {
    const res = await PATCH(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mocks.instanceService.touchActivity).toHaveBeenCalledWith('alice')
  })

  it('debounces when activity is recent', async () => {
    mocks.instanceService.findBySlug.mockResolvedValue({
      slug: 'alice',
      lastActivityAt: new Date(Date.now() - 5_000),
    })

    const res = await PATCH(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.debounced).toBe(true)
    expect(mocks.instanceService.touchActivity).not.toHaveBeenCalled()
  })

  it('returns 404 when instance not found', async () => {
    mocks.instanceService.findBySlug.mockResolvedValue(null)
    const res = await PATCH(makeRequest(), params('alice'))
    expect(res.status).toBe(404)
  })

  it('allows internal token auth bypassing session', async () => {
    process.env.ARCHE_INTERNAL_TOKEN = 'secret-token'
    mocks.getSession.mockResolvedValue(null)

    const res = await PATCH(
      makeRequest({ Authorization: 'Bearer secret-token' }),
      params('alice'),
    )
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('rejects wrong internal token', async () => {
    process.env.ARCHE_INTERNAL_TOKEN = 'secret-token'
    mocks.getSession.mockResolvedValue(null)

    const res = await PATCH(
      makeRequest({ Authorization: 'Bearer wrong-token' }),
      params('alice'),
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await PATCH(makeRequest(), params('alice'))
    expect(res.status).toBe(401)
  })
})
