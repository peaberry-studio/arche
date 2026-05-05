import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  fetchModelsCatalog: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/models-catalog', () => ({
  fetchModelsCatalog: (...args: unknown[]) => mocks.fetchModelsCatalog(...args),
}))

import { GET } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/u/alice/agents/models', { method: 'GET' })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('GET /api/u/[slug]/agents/models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.fetchModelsCatalog.mockResolvedValue({
      ok: true,
      models: [{ id: 'openai/gpt-4', label: 'OpenAI - GPT-4' }],
    })
  })

  it('returns models catalog on success', async () => {
    const res = await GET(makeRequest(), params('alice'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.models).toEqual([{ id: 'openai/gpt-4', label: 'OpenAI - GPT-4' }])
  })

  it('returns 503 when models catalog is unavailable', async () => {
    mocks.fetchModelsCatalog.mockResolvedValue({ ok: false, error: 'models_catalog_unavailable' })
    const res = await GET(makeRequest(), params('alice'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'models_catalog_unavailable' })
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await GET(makeRequest(), params('alice'))
    expect(res.status).toBe(401)
  })
})
