import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  isWorkspaceReachable: vi.fn(),
  createWorkspaceAgentClient: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/runtime/workspace-host', () => ({
  isWorkspaceReachable: mocks.isWorkspaceReachable,
}))
vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: mocks.createWorkspaceAgentClient,
}))

import { POST } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/instances/alice/publish-kb', {
    method: 'POST',
    headers: { Origin: 'http://localhost' },
  })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

function mockFetch(body: object, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('POST /api/instances/[slug]/publish-kb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.isWorkspaceReachable.mockResolvedValue(true)
    mocks.createWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Bearer tok',
    })
  })

  it('returns published result on success', async () => {
    const spy = mockFetch({ ok: true, status: 'published', commitHash: 'abc123' })
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body).toEqual({ ok: true, status: 'published', commitHash: 'abc123' })
    spy.mockRestore()
  })

  it('returns 409 when instance not running', async () => {
    mocks.isWorkspaceReachable.mockResolvedValue(false)
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(409)
  })

  it('returns 409 when agent unavailable', async () => {
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(409)
  })

  it('handles agent HTTP error', async () => {
    const spy = mockFetch({ message: 'internal error' }, 500)
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.status).toBe('error')
    spy.mockRestore()
  })

  it('handles non-JSON response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', { status: 500 }),
    )
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    spy.mockRestore()
  })

  it('handles network error', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.message).toBe('ECONNREFUSED')
    spy.mockRestore()
  })

  it('handles non-Error exception', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error')
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.message).toBe('Unknown error')
    spy.mockRestore()
  })
})
