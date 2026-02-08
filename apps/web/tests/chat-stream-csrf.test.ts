import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    instance: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callPostChatStream(slug = 'alice') {
  const { POST } = await import('@/app/api/w/[slug]/chat/stream/route')
  const req = new Request(`http://localhost/api/w/${slug}/chat/stream`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

describe('CSRF guard for chat stream route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'USER'))
    mockFindUnique.mockResolvedValue(null)
  })

  it('returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostChatStream('alice')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })
})
