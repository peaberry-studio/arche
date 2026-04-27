import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
}))

const mockHashArgon2 = vi.fn()
vi.mock('@/lib/argon2', () => ({
  hashArgon2: (...args: unknown[]) => mockHashArgon2(...args),
}))

const mockRequireCapability = vi.fn()
vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
}))

const mockUserFindMany = vi.fn()
const mockUserFindFirst = vi.fn()
const mockUserFindUnique = vi.fn()
const mockUserUpdate = vi.fn()
const mockSessionUpdateMany = vi.fn()
const mockTransaction = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    session: {
      updateMany: (...args: unknown[]) => mockSessionUpdateMany(...args),
    },
    user: {
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { user: { id: 'user-1', email: 'user@example.com', slug, role }, sessionId: 'session-1' }
}

async function callGetTeam(slug = 'alice') {
  const { GET } = await import('@/app/api/u/[slug]/team/route')

  const req = new Request(`http://localhost/api/u/${slug}/team`, {
    method: 'GET',
    headers: {
      host: 'localhost',
    },
  })

  const res = await GET(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callResetPassword(slug = 'alice', id = 'user-2', password = 'temporary-password') {
  const { POST } = await import('@/app/api/u/[slug]/team/[id]/password/route')

  const req = new Request(`http://localhost/api/u/${slug}/team/${id}/password`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })

  const res = await POST(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

describe('GET /api/u/[slug]/team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'ADMIN'))
    mockRequireCapability.mockReturnValue(null)
    mockUserFindFirst.mockResolvedValue(null)
  })

  it('returns all team users when team management is available', async () => {
    mockUserFindMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'admin@example.com',
        slug: 'alice',
        role: 'ADMIN',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'user-2',
        email: 'user@example.com',
        slug: 'bob',
        role: 'USER',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ])

    const { status, body } = await callGetTeam('alice')

    expect(status).toBe(200)
    expect(body.users).toEqual([
      {
        id: 'user-1',
        email: 'admin@example.com',
        slug: 'alice',
        role: 'ADMIN',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'user-2',
        email: 'user@example.com',
        slug: 'bob',
        role: 'USER',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ])
    expect(mockUserFindUnique).not.toHaveBeenCalled()
  })

  it('returns the current user when team management is unavailable', async () => {
    mockRequireCapability.mockReturnValue(
      NextResponse.json({ error: 'teamManagement is not available in this runtime mode' }, { status: 403 })
    )
    mockUserFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      slug: 'alice',
      role: 'ADMIN',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const { status, body } = await callGetTeam('alice')

    expect(status).toBe(200)
    expect(body.users).toEqual([
      {
        id: 'user-1',
        email: 'admin@example.com',
        slug: 'alice',
        role: 'ADMIN',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    expect(mockUserFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty list when current user record is missing in fallback mode', async () => {
    mockRequireCapability.mockReturnValue(
      NextResponse.json({ error: 'teamManagement is not available in this runtime mode' }, { status: 403 })
    )
    mockUserFindFirst.mockResolvedValue(null)

    const { status, body } = await callGetTeam('alice')

    expect(status).toBe(200)
    expect(body.users).toEqual([])
    expect(mockUserFindMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/u/[slug]/team/[id]/password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'ADMIN'))
    mockRequireCapability.mockReturnValue(null)
    mockUserFindFirst.mockResolvedValue({
      id: 'user-2',
      email: 'bob@example.com',
      slug: 'bob',
      role: 'USER',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    mockHashArgon2.mockResolvedValue('$hashed-password$')
    mockUserUpdate.mockResolvedValue({ id: 'user-2' })
    mockSessionUpdateMany.mockResolvedValue({ count: 2 })
    mockTransaction.mockImplementation(async (callback: (tx: {
      user: { update: typeof mockUserUpdate }
      session: { updateMany: typeof mockSessionUpdateMany }
    }) => unknown) =>
      callback({
        user: { update: mockUserUpdate },
        session: { updateMany: mockSessionUpdateMany },
      })
    )
  })

  it('updates the password hash and revokes active sessions for the target user', async () => {
    const { status, body } = await callResetPassword('alice', 'user-2')

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mockHashArgon2).toHaveBeenCalledWith('temporary-password')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { passwordHash: '$hashed-password$' },
    })
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-2', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(mockAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.password_reset' }),
    )
  })

  it('rejects short passwords before hashing', async () => {
    const { status, body } = await callResetPassword('alice', 'user-2', 'short')

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'invalid_password', message: 'Password must be at least 8 characters.' })
    expect(mockHashArgon2).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns forbidden for non-admin users', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'USER'))

    const { status, body } = await callResetPassword('alice', 'user-2')

    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })
})
