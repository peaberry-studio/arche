import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestUser = {
  id: string
  email: string
  slug: string
  role: 'ADMIN' | 'USER'
}

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  createToken: vi.fn(),
  findManyByUserId: vi.fn(),
  findManyWithUsers: vi.fn(),
  getSettings: vi.fn(),
  isUserAllowed: vi.fn(),
  revokeById: vi.fn(),
  revokeByIdAndUserId: vi.fn(),
  user: { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER' as 'ADMIN' | 'USER' },
}))

vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/security', () => ({ getSessionPepper: () => 'pepper' }))
vi.mock('@/lib/runtime/with-auth', () => ({
  withAuth: (_options: unknown, handler: (request: Request, context: {
    user: TestUser
    sessionId: string
    slug: string
    params: { slug: string; id?: string }
  }) => Promise<Response>) => async (request: Request, context: { params: Promise<{ slug: string; id?: string }> }) => {
    const params = await context.params
    return handler(request, { user: mocks.user, sessionId: 'session-1', slug: params.slug, params })
  },
}))
vi.mock('@/lib/services', () => ({
  mcpSettingsService: {
    getSettings: mocks.getSettings,
    isUserAllowed: mocks.isUserAllowed,
  },
  patService: {
    create: mocks.createToken,
    findManyByUserId: mocks.findManyByUserId,
    findManyWithUsers: mocks.findManyWithUsers,
    revokeById: mocks.revokeById,
    revokeByIdAndUserId: mocks.revokeByIdAndUserId,
  },
}))

import { DELETE } from '@/app/api/u/[slug]/mcp/tokens/[id]/route'
import { POST } from '@/app/api/u/[slug]/mcp/tokens/route'

describe('/api/u/[slug]/mcp/tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.id = 'u1'
    mocks.user.email = 'alice@example.com'
    mocks.user.slug = 'alice'
    mocks.user.role = 'USER'
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.getSettings.mockResolvedValue({ enabled: true })
    mocks.isUserAllowed.mockResolvedValue(true)
    mocks.createToken.mockResolvedValue(createTokenRecord())
    mocks.revokeById.mockResolvedValue({ count: 1 })
    mocks.revokeByIdAndUserId.mockResolvedValue({ count: 1 })
  })

  it('rejects token creation for disallowed users', async () => {
    mocks.isUserAllowed.mockResolvedValue(false)

    const response = await POST(createPostRequest({ name: 'MCP', scopes: ['kb:read'], expiresInDays: 30 }), routeContext())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'mcp_user_disallowed' })
    expect(mocks.createToken).not.toHaveBeenCalled()
  })

  it('uses kb:read as the minimal default scope', async () => {
    const response = await POST(createPostRequest({ name: 'MCP', expiresInDays: 30 }), routeContext())

    expect(response.status).toBe(201)
    expect(mocks.createToken).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['kb:read'] }))
    await expect(response.json()).resolves.toMatchObject({ record: { scopes: ['kb:read'] } })
  })

  it('revokes a created token when audit fails before returning the one-time secret', async () => {
    mocks.auditEvent.mockRejectedValue(new Error('audit_failed'))

    await expect(POST(createPostRequest({ name: 'MCP', expiresInDays: 30 }), routeContext())).rejects.toThrow('audit_failed')
    expect(mocks.createToken).toHaveBeenCalled()
    expect(mocks.revokeById).toHaveBeenCalledWith('pat-1')
  })

  it('allows admins to revoke any token', async () => {
    mocks.user.role = 'ADMIN'

    const response = await DELETE(new Request('https://example.com'), routeContext({ id: 'pat-2' }))

    expect(response.status).toBe(200)
    expect(mocks.revokeById).toHaveBeenCalledWith('pat-2')
    expect(mocks.revokeByIdAndUserId).not.toHaveBeenCalled()
  })
})

function createPostRequest(body: Record<string, unknown>): Request {
  return new Request('https://example.com/api/u/alice/mcp/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function routeContext(input: { id?: string } = {}): { params: Promise<{ slug: string; id?: string }> } {
  return { params: Promise.resolve({ slug: 'alice', ...input }) }
}

function createTokenRecord() {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'pat-1',
    name: 'MCP',
    scopes: ['kb:read'],
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: now,
  }
}
