import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string

      constructor(message: string, options?: { code?: string }) {
        super(message)
        this.code = options?.code ?? 'P0000'
      }
    },
  },
  UserRole: {
    ADMIN: 'ADMIN',
    USER: 'USER',
  },
}))

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: vi.fn(),
}))

vi.mock('@/lib/runtime/workspace-host', () => ({
  stopWorkspace: vi.fn(),
}))

const mockUserFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callPostTeam(slug = 'admin') {
  const { POST } = await import('@/app/api/u/[slug]/team/route')
  const req = new Request(`http://localhost/api/u/${slug}/team`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: 'not-json',
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callPatchTeam(slug = 'admin', id = 'user-2') {
  const { PATCH } = await import('@/app/api/u/[slug]/team/[id]/route')
  const req = new Request(`http://localhost/api/u/${slug}/team/${id}`, {
    method: 'PATCH',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: 'not-json',
  })
  const res = await PATCH(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

async function callDeleteTeam(slug = 'admin', id = 'user-2') {
  const { DELETE } = await import('@/app/api/u/[slug]/team/[id]/route')
  const req = new Request(`http://localhost/api/u/${slug}/team/${id}`, {
    method: 'DELETE',
    headers: {
      host: 'localhost',
    },
  })
  const res = await DELETE(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

async function callResetPassword(slug = 'admin', id = 'user-2') {
  const { POST } = await import('@/app/api/u/[slug]/team/[id]/password/route')
  const req = new Request(`http://localhost/api/u/${slug}/team/${id}/password`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password: 'temporary-password' }),
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

describe('CSRF guard for team routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('admin', 'ADMIN'))
    mockUserFindUnique.mockResolvedValue(null)
  })

  it('POST /api/u/[slug]/team returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostTeam('admin')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('PATCH /api/u/[slug]/team/[id] returns 403 when Origin is missing', async () => {
    const { status, body } = await callPatchTeam('admin', 'user-2')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('DELETE /api/u/[slug]/team/[id] returns 403 when Origin is missing', async () => {
    const { status, body } = await callDeleteTeam('admin', 'user-2')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST /api/u/[slug]/team/[id]/password returns 403 when Origin is missing', async () => {
    const { status, body } = await callResetPassword('admin', 'user-2')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })
})
