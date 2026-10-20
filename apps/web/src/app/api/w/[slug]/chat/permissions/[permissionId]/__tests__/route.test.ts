import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  getRuntimeForSlug: vi.fn(),
  isArchivedSession: vi.fn(),
  replyPermission: vi.fn(),
  auditEvent: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/services/legacy-session-archive', () => ({ isArchivedSession: mocks.isArchivedSession }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: mocks.getRuntimeForSlug }))

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
    mocks.isArchivedSession.mockResolvedValue(false)
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: { replyPermission: mocks.replyPermission } })
    mocks.replyPermission.mockResolvedValue({ ok: true })
    mocks.auditEvent.mockResolvedValue(undefined)
  })

  it.each(['once', 'always', 'reject'])('forwards the Arche permission response %s to the runtime', async (response) => {

    const request = makeRequest({ sessionId: 's1', response })
    const res = await POST(request, params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mocks.replyPermission).toHaveBeenCalledWith({
      sessionId: 's1', permissionId: 'perm-1', response,
    }, { signal: request.signal })
  })

  it.each(['USER', 'ADMIN'])('rejects archived permission replies as %s without runtime or audit calls', async (role) => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', slug: role === 'ADMIN' ? 'admin' : 'alice', role }, sessionId: 'auth' })
    mocks.isArchivedSession.mockResolvedValue(true)
    const res = await POST(makeRequest({ sessionId: 'old', response: 'once' }), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'session_archived' })
    expect(mocks.isArchivedSession).toHaveBeenCalledWith('alice', 'old')
    expect(mocks.getRuntimeForSlug).not.toHaveBeenCalled()
    expect(mocks.replyPermission).not.toHaveBeenCalled()
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })

  it.each([null, { user: { id: 'bob', slug: 'bob', role: 'USER' }, sessionId: 'auth' }])('authorizes before archive storage access', async (session) => {
    mocks.getSession.mockResolvedValue(session)
    const res = await POST(makeRequest({ sessionId: 'old', response: 'always' }), params())
    expect(res.status).toBe(session ? 403 : 401)
    expect(mocks.isArchivedSession).not.toHaveBeenCalled()
    expect(mocks.getRuntimeForSlug).not.toHaveBeenCalled()
    expect(mocks.replyPermission).not.toHaveBeenCalled()
  })

  it('audits an administrator response for another workspace', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
      sessionId: 'admin-session',
    })

    const res = await POST(makeRequest({ sessionId: 's1', response: 'always' }), params())

    expect(res.status).toBe(200)
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      metadata: {
        permissionId: 'perm-1',
        response: 'always',
        sessionId: 's1',
        slug: 'alice',
      },
    }))
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
    mocks.replyPermission.mockResolvedValue({ ok: false, error: { code: 'instance_unavailable' } })

    const res = await POST(makeRequest({ sessionId: 's1', response: 'once' }), params())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('instance_unavailable')
  })

  it('returns 502 when OpenCode rejects the permission response', async () => {
    mocks.replyPermission.mockResolvedValue({ ok: false, error: { code: 'runtime_error', status: 500 } })

    const res = await POST(makeRequest({ sessionId: 's1', response: 'once' }), params())
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toBe('permission_reply_failed')
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })

  it('preserves OpenCode client error statuses', async () => {
    mocks.replyPermission.mockResolvedValue({ ok: false, error: { code: 'runtime_error', status: 403 } })

    const res = await POST(makeRequest({ sessionId: 's1', response: 'once' }), params())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('permission_reply_failed')
  })
})
