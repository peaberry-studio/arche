import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  instanceService: { findCredentialsBySlug: vi.fn() },
  decryptPassword: vi.fn(() => 'secret'),
  getInstanceUrl: vi.fn(() => 'http://test-slug:3000'),
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
vi.mock('@/lib/spawner/crypto', () => ({ decryptPassword: mocks.decryptPassword }))
vi.mock('@/lib/opencode/client', () => ({ getInstanceUrl: mocks.getInstanceUrl }))

import { POST } from '../route'

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/w/alice/chat/permissions/perm-1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
  })
}

function makeRawRequest(body: string) {
  return new NextRequest('http://localhost/api/w/alice/chat/permissions/perm-1', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
  })
}

function params() {
  return { params: Promise.resolve({ slug: 'alice', permissionId: 'perm-1' }) }
}

describe('POST /api/w/[slug]/chat/permissions/[permissionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({
      status: 'running',
      serverPassword: 'enc:pw',
    })
    mocks.decryptPassword.mockReturnValue('secret')
    mocks.getInstanceUrl.mockReturnValue('http://test-slug:3000')
  })

  it('forwards permission response to OpenCode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeRequest({ sessionId: 's1', response: 'always' }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test-slug:3000/session/s1/permissions/perm-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ response: 'always' }),
      }),
    )
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeRequest({ sessionId: 's1', response: 'bad' }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('missing_fields')
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    const res = await POST(makeRawRequest('{'), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_json')
  })

  it('returns 400 when the session ID is blank', async () => {
    const res = await POST(makeRequest({ sessionId: '  ', response: 'once' }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('missing_fields')
  })

  it('returns 503 when the workspace instance is unavailable', async () => {
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({ status: 'stopped', serverPassword: null })

    const res = await POST(makeRequest({ sessionId: 's1', response: 'once' }), params())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('instance_unavailable')
  })

  it('returns 502 when OpenCode rejects the permission response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    const res = await POST(makeRequest({ sessionId: 's1', response: 'once' }), params())
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toBe('permission_reply_failed')
  })

  it('preserves OpenCode client error statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))

    const res = await POST(makeRequest({ sessionId: 's1', response: 'once' }), params())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('permission_reply_failed')
  })
})
