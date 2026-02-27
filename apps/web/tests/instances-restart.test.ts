import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockGetKickstartStatus = vi.fn()
vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: (...args: unknown[]) => mockGetKickstartStatus(...args),
}))

const mockStopInstance = vi.fn()
const mockStartInstance = vi.fn()
vi.mock('@/lib/spawner/core', () => ({
  stopInstance: (...args: unknown[]) => mockStopInstance(...args),
  startInstance: (...args: unknown[]) => mockStartInstance(...args),
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

async function callPostRestart(slug = 'alice') {
  const { POST } = await import('@/app/api/instances/[slug]/restart/route')
  const req = new Request(`http://localhost/api/instances/${slug}/restart`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
    },
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

describe('POST /api/instances/[slug]/restart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockGetKickstartStatus.mockResolvedValue('ready')
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
    mockStopInstance.mockResolvedValue({ ok: true })
    mockStartInstance.mockResolvedValue({ ok: true, status: 'running' })
  })

  it('returns 401 without session', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)

    const { status, body } = await callPostRestart('alice')

    expect(status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('returns 403 when user is not authorized for slug', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('bob'))

    const { status, body } = await callPostRestart('alice')

    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('returns 404 when slug does not map to a user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('admin', 'ADMIN'))
    mockUserFindUnique.mockResolvedValue(null)

    const { status, body } = await callPostRestart('missing-slug')

    expect(status).toBe(404)
    expect(body.error).toBe('user_not_found')
    expect(mockStopInstance).not.toHaveBeenCalled()
    expect(mockStartInstance).not.toHaveBeenCalled()
  })
})
