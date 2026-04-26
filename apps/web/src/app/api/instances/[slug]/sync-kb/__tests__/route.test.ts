import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetRuntimeCapabilities,
  mockIsDesktop,
  mockGetSession,
  mockValidateSameOrigin,
  mockValidateDesktopToken,
  mockIsWorkspaceReachable,
  mockCreateWorkspaceAgentClient,
} = vi.hoisted(() => ({
  mockGetRuntimeCapabilities: vi.fn(),
  mockIsDesktop: vi.fn(),
  mockGetSession: vi.fn(),
  mockValidateSameOrigin: vi.fn(),
  mockValidateDesktopToken: vi.fn(),
  mockIsWorkspaceReachable: vi.fn(),
  mockCreateWorkspaceAgentClient: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mockGetRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mockIsDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mockValidateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-desktop-token',
  validateDesktopToken: mockValidateDesktopToken,
}))
vi.mock('@/lib/runtime/workspace-host', () => ({
  isWorkspaceReachable: mockIsWorkspaceReachable,
}))
vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: mockCreateWorkspaceAgentClient,
}))

import { GET, POST } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function makeRequest(method: string) {
  return new NextRequest('http://localhost/api/instances/alice/sync-kb', {
    method,
    headers: { Origin: 'http://localhost' },
  })
}

function mockFetch(body: object, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

describe('POST /api/instances/[slug]/sync-kb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockIsWorkspaceReachable.mockResolvedValue(true)
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Bearer tok',
    })
  })

  it('returns synced result on success', async () => {
    const spy = mockFetch({ ok: true, status: 'synced' })
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body).toEqual({ ok: true, status: 'synced' })
    spy.mockRestore()
  })

  it('returns conflicts from agent', async () => {
    const spy = mockFetch({ ok: true, status: 'conflicts', conflicts: ['file.txt'] })
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body.status).toBe('conflicts')
    expect(body.conflicts).toEqual(['file.txt'])
    spy.mockRestore()
  })

  it('returns 409 when instance not running', async () => {
    mockIsWorkspaceReachable.mockResolvedValue(false)
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    expect(res.status).toBe(409)
  })

  it('returns 409 when agent unavailable', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue(null)
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    expect(res.status).toBe(409)
  })

  it('handles agent HTTP error', async () => {
    const spy = mockFetch({ message: 'internal error' }, 500)
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.status).toBe('error')
    spy.mockRestore()
  })

  it('handles non-JSON response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', { status: 500 }),
    )
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body.ok).toBe(false)
    spy.mockRestore()
  })

  it('handles network error', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.message).toBe('ECONNREFUSED')
    spy.mockRestore()
  })

  it('handles non-Error exception', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error')
    const res = await POST(makeRequest('POST'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body.message).toBe('Unknown error')
    spy.mockRestore()
  })
})

describe('GET /api/instances/[slug]/sync-kb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockIsWorkspaceReachable.mockResolvedValue(true)
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Bearer tok',
    })
  })

  it('returns no conflicts', async () => {
    const spy = mockFetch({ ok: true, hasConflicts: false })
    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body).toEqual({ hasConflicts: false })
    spy.mockRestore()
  })

  it('returns conflicts list', async () => {
    const spy = mockFetch({ ok: true, hasConflicts: true, conflicts: ['a.txt', 'b.txt'] })
    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'alice' }) })
    const body = await res.json()
    expect(body.hasConflicts).toBe(true)
    expect(body.conflicts).toEqual(['a.txt', 'b.txt'])
    spy.mockRestore()
  })

  it('returns 409 when instance not running', async () => {
    mockIsWorkspaceReachable.mockResolvedValue(false)
    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'alice' }) })
    expect(res.status).toBe(409)
  })

  it('returns 409 when agent unavailable', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue(null)
    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'alice' }) })
    expect(res.status).toBe(409)
  })

  it('handles agent HTTP error', async () => {
    const spy = mockFetch({ ok: false, error: 'kb_error' }, 500)
    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'alice' }) })
    expect(res.status).toBe(500)
    spy.mockRestore()
  })

  it('handles network error', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'alice' }) })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('timeout')
    spy.mockRestore()
  })
})
