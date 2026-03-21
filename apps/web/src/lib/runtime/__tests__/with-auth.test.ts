import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeSessionResult } from '@/lib/runtime/types'

const mockGetSession = vi.fn<() => Promise<RuntimeSessionResult>>()
vi.mock('@/lib/runtime/session', () => ({
  getSession: () => mockGetSession(),
}))

const mockIsDesktop = vi.fn(() => false)
vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => mockIsDesktop(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => ({
    multiUser: true,
    auth: true,
    containers: true,
    csrf: true,
    twoFactor: true,
    teamManagement: true,
    connectors: true,
    kickstart: true,
  }),
}))

vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: vi.fn((request: NextRequest) => {
    const origin = request.headers.get('origin')
    return origin ? { ok: true } : { ok: false }
  }),
}))

const mockValidateDesktopToken = vi.fn(() => false)
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: (token: string | null) => mockValidateDesktopToken(token),
}))

import { withAuth } from '../with-auth'

function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { host: 'localhost', ...headers },
  })
}

function makeHandler() {
  return vi.fn(async (_req: NextRequest, ctx: { user: { slug: string }; slug: string }) => {
    return NextResponse.json({ slug: ctx.slug, user: ctx.user.slug })
  })
}

describe('withAuth wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when session is null', async () => {
    mockGetSession.mockResolvedValue(null)

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/alice/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'alice' }) })

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 403 when slug does not match and user is not ADMIN', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', slug: 'bob', role: 'USER' },
      sessionId: 's1',
    })

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/alice/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'alice' }) })

    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('allows ADMIN to access other slugs', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'u1', email: 'admin@b.com', slug: 'admin', role: 'ADMIN' },
      sessionId: 's1',
    })

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/alice/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'alice' }) })

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('allows user to access own slug', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/alice/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'alice' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.slug).toBe('alice')
  })

  it('returns 403 when csrf: true and origin header is missing', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: true }, handler)
    const req = makeRequest('POST', 'http://localhost/api/u/alice/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'alice' }) })

    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes CSRF check when origin header is present', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: true }, handler)
    const req = makeRequest('POST', 'http://localhost/api/u/alice/agents', {
      origin: 'http://localhost',
    })
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'alice' }) })

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('provides correct AuthContext to the handler', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    }
    mockGetSession.mockResolvedValue(session)

    const handler = vi.fn(async (_req: NextRequest, ctx: unknown) => {
      return NextResponse.json(ctx)
    })

    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/alice/agents')
    await wrapped(req, { params: Promise.resolve({ slug: 'alice' }) })

    expect(handler).toHaveBeenCalledWith(req, {
      user: session.user,
      sessionId: 's1',
      slug: 'alice',
      params: { slug: 'alice' },
    })
  })
})

describe('withAuth desktop token validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDesktop.mockReturnValue(true)
    mockGetSession.mockResolvedValue({
      user: { id: 'local', email: 'local@arche.local', slug: 'local', role: 'ADMIN' },
      sessionId: 'local',
    })
  })

  it('returns 401 when desktop token is missing', async () => {
    mockValidateDesktopToken.mockReturnValue(false)

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/local/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'local' }) })

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(mockValidateDesktopToken).toHaveBeenCalledWith(null)
  })

  it('returns 401 when desktop token is invalid', async () => {
    mockValidateDesktopToken.mockReturnValue(false)

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/local/agents', {
      'x-arche-desktop-token': 'wrong-token',
    })
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'local' }) })

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(mockValidateDesktopToken).toHaveBeenCalledWith('wrong-token')
  })

  it('allows request when desktop token is valid', async () => {
    mockValidateDesktopToken.mockReturnValue(true)

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/local/agents', {
      'x-arche-desktop-token': 'valid-token',
    })
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'local' }) })

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('skips token check in web mode', async () => {
    mockIsDesktop.mockReturnValue(false)

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: false }, handler)
    const req = makeRequest('GET', 'http://localhost/api/u/local/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'local' }) })

    expect(res.status).toBe(200)
    expect(mockValidateDesktopToken).not.toHaveBeenCalled()
  })

  it('validates token before checking CSRF', async () => {
    mockValidateDesktopToken.mockReturnValue(false)

    const handler = makeHandler()
    const wrapped = withAuth({ csrf: true }, handler)
    const req = makeRequest('POST', 'http://localhost/api/u/local/agents')
    const res = await wrapped(req, { params: Promise.resolve({ slug: 'local' }) })

    // Should fail on token check (401) not CSRF check (403)
    expect(res.status).toBe(401)
  })
})
