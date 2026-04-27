import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetRuntimeCapabilities,
  mockIsDesktop,
  mockGetSession,
  mockValidateSameOrigin,
  mockValidateDesktopToken,
  mockRequireCapability,
  mockAuditEvent,
  mockHashArgon2,
  mockUserService,
} = vi.hoisted(() => ({
  mockGetRuntimeCapabilities: vi.fn(),
  mockIsDesktop: vi.fn(),
  mockGetSession: vi.fn(),
  mockValidateSameOrigin: vi.fn(),
  mockValidateDesktopToken: vi.fn(),
  mockRequireCapability: vi.fn(),
  mockAuditEvent: vi.fn(),
  mockHashArgon2: vi.fn(),
  mockUserService: {
    findTeamMembers: vi.fn(),
    findTeamMemberById: vi.fn(),
    findIdBySlug: vi.fn(),
    findExistingByEmailOrSlug: vi.fn(),
    create: vi.fn(),
  },
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mockGetRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mockIsDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mockValidateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-desktop-token',
  validateDesktopToken: mockValidateDesktopToken,
}))
vi.mock('@/lib/runtime/require-capability', () => ({ requireCapability: mockRequireCapability }))
vi.mock('@/lib/auth', () => ({ auditEvent: mockAuditEvent }))
vi.mock('@/lib/argon2', () => ({ hashArgon2: mockHashArgon2 }))
vi.mock('@/lib/services', () => ({ userService: mockUserService }))
vi.mock('@/lib/validation/slug', () => ({
  validateSlug: (slug: string) => {
    if (!slug || slug.length < 3) return { valid: false, error: 'too short' }
    return { valid: true }
  },
}))

import { GET, POST } from '../route'

const TEST_SESSION = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

function makeRequest(method: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json', Origin: 'http://localhost' }
  }
  return new NextRequest('http://localhost/api/u/admin/team', init)
}

describe('GET /api/u/[slug]/team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false, teamManagement: true })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockRequireCapability.mockReturnValue(null)
  })

  it('lists all team members when admin', async () => {
    const users = [
      { id: 'u1', email: 'a@test.com', slug: 'alice', role: 'ADMIN', createdAt: new Date('2026-01-01') },
      { id: 'u2', email: 'b@test.com', slug: 'bob', role: 'USER', createdAt: new Date('2026-02-01') },
    ]
    mockUserService.findTeamMembers.mockResolvedValue(users)

    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'admin' }) })
    const body = await res.json()

    expect(body.users).toHaveLength(2)
    expect(body.users[0].slug).toBe('alice')
    expect(body.users[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('returns only current user when teamManagement denied', async () => {
    mockRequireCapability.mockReturnValue(null)
    const { NextResponse } = await import('next/server')
    mockRequireCapability.mockReturnValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    mockUserService.findTeamMemberById.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@test.com',
      slug: 'admin',
      role: 'ADMIN',
      createdAt: new Date('2026-01-01'),
    })

    const res = await GET(makeRequest('GET'), { params: Promise.resolve({ slug: 'admin' }) })
    const body = await res.json()

    expect(body.users).toHaveLength(1)
    expect(body.users[0].slug).toBe('admin')
  })
})

describe('POST /api/u/[slug]/team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false, teamManagement: true })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockRequireCapability.mockReturnValue(null)
    mockHashArgon2.mockResolvedValue('$hashed$')
    mockUserService.findExistingByEmailOrSlug.mockResolvedValue(null)
  })

  it('creates a team user', async () => {
    const created = {
      id: 'new-1',
      email: 'new@test.com',
      slug: 'newuser',
      role: 'USER',
      createdAt: new Date('2026-03-01'),
    }
    mockUserService.create.mockResolvedValue(created)

    const res = await POST(
      makeRequest('POST', { email: 'new@test.com', slug: 'newuser', password: 'temporary-password', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.user.email).toBe('new@test.com')
    expect(mockAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.created' }),
    )
  })

  it('rejects non-admin', async () => {
    mockGetSession.mockResolvedValue({
      ...TEST_SESSION,
      user: { ...TEST_SESSION.user, role: 'USER' },
    })

    const res = await POST(
      makeRequest('POST', { email: 'x@x.com', slug: 'xxx', password: 'p', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    expect(res.status).toBe(403)
  })

  it('rejects invalid email', async () => {
    const res = await POST(
      makeRequest('POST', { email: 'bad-email', slug: 'newuser', password: 'p', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_email')
  })

  it('rejects invalid slug', async () => {
    const res = await POST(
      makeRequest('POST', { email: 'a@b.com', slug: 'ab', password: 'p', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    expect(res.status).toBe(400)
  })

  it('rejects empty password', async () => {
    const res = await POST(
      makeRequest('POST', { email: 'a@b.com', slug: 'newuser', password: '', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'invalid_password', message: 'Password is required.' })
  })

  it('rejects short password', async () => {
    const res = await POST(
      makeRequest('POST', { email: 'a@b.com', slug: 'newuser', password: 'short', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'invalid_password', message: 'Password must be at least 8 characters.' })
  })

  it('rejects invalid role', async () => {
    const res = await POST(
      makeRequest('POST', { email: 'a@b.com', slug: 'newuser', password: 'temporary-password', role: 'SUPERADMIN' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    expect(res.status).toBe(400)
  })

  it('rejects duplicate email', async () => {
    mockUserService.findExistingByEmailOrSlug.mockResolvedValue({ email: 'a@b.com' })
    const res = await POST(
      makeRequest('POST', { email: 'a@b.com', slug: 'newuser', password: 'temporary-password', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error).toBe('email_in_use')
  })

  it('rejects duplicate slug', async () => {
    mockUserService.findExistingByEmailOrSlug.mockResolvedValue({ email: 'other@b.com', slug: 'newuser' })
    const res = await POST(
      makeRequest('POST', { email: 'a@b.com', slug: 'newuser', password: 'temporary-password', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error).toBe('slug_in_use')
  })

  it('handles P2002 from create', async () => {
    mockUserService.create.mockRejectedValue({ code: 'P2002' })
    const res = await POST(
      makeRequest('POST', { email: 'a@b.com', slug: 'newuser', password: 'temporary-password', role: 'USER' }),
      { params: Promise.resolve({ slug: 'admin' }) },
    )
    expect(res.status).toBe(409)
  })

  it('rejects invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/u/admin/team', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(400)
  })
})
