import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
}))

const mockFindUnique = vi.fn()
const mockFindMany = vi.fn()
const mockUpdateMany = vi.fn()
const mockCreate = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    providerCredential: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}))

function session(slug: string, role = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callGetProviders(slug = 'alice') {
  const { GET } = await import('@/app/api/u/[slug]/providers/route')
  const req = new Request(`http://localhost/api/u/${slug}/providers`)
  const res = await GET(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callPostProvider(
  slug = 'alice',
  provider = 'openai',
  body: unknown = { apiKey: 'sk-123' }
) {
  const { POST } = await import('@/app/api/u/[slug]/providers/[provider]/route')
  const req = new Request(`http://localhost/api/u/${slug}/providers/${provider}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug, provider }) })
  return { status: res.status, body: await res.json() }
}

describe('GET /api/u/[slug]/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)
    const { status, body } = await callGetProviders()
    expect(status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('returns 403 when user is not owner or admin', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('bob'))
    const { status, body } = await callGetProviders('alice')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('returns 404 when user is missing', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(null)
    const { status, body } = await callGetProviders('alice')
    expect(status).toBe(404)
    expect(body.error).toBe('user_not_found')
  })

  it('returns provider list with latest credentials and missing entries', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue({ id: 'user-1' })
    mockFindMany.mockResolvedValue([
      { providerId: 'openai', status: 'enabled', type: 'api', version: 2 },
      { providerId: 'openai', status: 'disabled', type: 'api', version: 1 },
    ])

    const { status, body } = await callGetProviders('alice')
    expect(status).toBe(200)
    expect(body.providers).toEqual([
      { providerId: 'openai', status: 'enabled', type: 'api', version: 2 },
      { providerId: 'anthropic', status: 'missing' },
      { providerId: 'openrouter', status: 'missing' },
    ])
  })
})

describe('POST /api/u/[slug]/providers/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)
    const { status, body } = await callPostProvider()
    expect(status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('returns 403 for non-admin user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const { status, body } = await callPostProvider('alice', 'openai')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('returns 400 for invalid provider', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('admin', 'ADMIN'))
    mockFindUnique.mockResolvedValue({ id: 'user-1' })
    const { status, body } = await callPostProvider('alice', 'invalid')
    expect(status).toBe(400)
    expect(body.error).toBe('invalid_provider')
  })

  it('returns 400 when apiKey is missing', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('admin', 'ADMIN'))
    mockFindUnique.mockResolvedValue({ id: 'user-1' })
    const { status, body } = await callPostProvider('alice', 'openai', { apiKey: ' ' })
    expect(status).toBe(400)
    expect(body.error).toBe('missing_fields')
  })

  it('creates new credential and audits creation', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('admin', 'ADMIN'))
    mockFindUnique.mockResolvedValue({ id: 'user-1' })
    mockFindMany.mockResolvedValue([{ version: 2 }])
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockCreate.mockResolvedValue({
      id: 'cred-1',
      providerId: 'openai',
      type: 'api',
      status: 'enabled',
      version: 3,
    })

    const { status, body } = await callPostProvider('alice', 'openai', { apiKey: 'sk-123' })
    expect(status).toBe(201)
    expect(body).toEqual({
      id: 'cred-1',
      providerId: 'openai',
      type: 'api',
      status: 'enabled',
      version: 3,
    })
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', providerId: 'openai' },
      data: { status: 'disabled' },
    })
    expect(mockCreate).toHaveBeenCalled()
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'provider_credential.created',
      metadata: { providerId: 'openai', credentialId: 'cred-1' },
    })
  })
})
