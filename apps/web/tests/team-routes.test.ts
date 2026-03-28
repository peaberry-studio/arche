import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: vi.fn(),
}))

const mockRequireCapability = vi.fn()
vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
}))

const mockUserFindMany = vi.fn()
const mockUserFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
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

describe('GET /api/u/[slug]/team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'ADMIN'))
    mockRequireCapability.mockReturnValue(null)
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
    mockUserFindUnique.mockResolvedValue({
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
    mockUserFindUnique.mockResolvedValue(null)

    const { status, body } = await callGetTeam('alice')

    expect(status).toBe(200)
    expect(body.users).toEqual([])
    expect(mockUserFindMany).not.toHaveBeenCalled()
  })
})
