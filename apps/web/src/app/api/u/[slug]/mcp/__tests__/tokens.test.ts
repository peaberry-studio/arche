import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestUser = {
  id: string
  email: string
  slug: string
  role: 'ADMIN' | 'USER'
}

const mocks = vi.hoisted(() => ({
  createUserMcpToken: vi.fn(),
  getUserMcpSettings: vi.fn(),
  listUserMcpTokens: vi.fn(),
  revokeUserMcpToken: vi.fn(),
  user: { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER' as 'ADMIN' | 'USER' },
}))

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

vi.mock('@/lib/mcp/management-service', () => ({
  createUserMcpToken: mocks.createUserMcpToken,
  getUserMcpSettings: mocks.getUserMcpSettings,
  listUserMcpTokens: mocks.listUserMcpTokens,
  revokeUserMcpToken: mocks.revokeUserMcpToken,
}))

import { GET as GET_TOKEN_SETTINGS } from '@/app/api/u/[slug]/mcp/settings/route'
import { DELETE } from '@/app/api/u/[slug]/mcp/tokens/[id]/route'
import { GET, POST } from '@/app/api/u/[slug]/mcp/tokens/route'

describe('/api/u/[slug]/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.id = 'u1'
    mocks.user.email = 'alice@example.com'
    mocks.user.slug = 'alice'
    mocks.user.role = 'USER'
    mocks.createUserMcpToken.mockResolvedValue({ ok: true, token: 'arche_pat_secret', record: createTokenRecord() })
    mocks.getUserMcpSettings.mockResolvedValue({ ok: true, enabled: true, mcpAllowed: true })
    mocks.listUserMcpTokens.mockResolvedValue({ ok: true, tokens: [createTokenRecord()] })
    mocks.revokeUserMcpToken.mockResolvedValue({ ok: true })
  })

  it('returns only the slug owner MCP access state from the slug settings route', async () => {
    const response = await GET_TOKEN_SETTINGS(new Request('https://example.com'), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ enabled: true, mcpAllowed: true })
    expect(mocks.getUserMcpSettings).toHaveBeenCalledWith({ actor: mocks.user, slug: 'alice' })
  })

  it('lists only slug-owned tokens from the slug token route', async () => {
    const response = await GET(new Request('https://example.com'), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ tokens: [serializeTokenRecord()] })
    expect(mocks.listUserMcpTokens).toHaveBeenCalledWith({ actor: mocks.user, slug: 'alice' })
  })

  it('uses kb:read as the minimal default scope when creating a token', async () => {
    const response = await POST(createPostRequest({ name: 'MCP', expiresInDays: 30 }), routeContext())

    expect(response.status).toBe(201)
    expect(mocks.createUserMcpToken).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['kb:read'] }))
    await expect(response.json()).resolves.toEqual({ token: 'arche_pat_secret', record: serializeTokenRecord() })
  })

  it('returns validation errors for non-object token creation bodies', async () => {
    const response = await POST(createPostRequest(null), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_name' })
    expect(mocks.createUserMcpToken).not.toHaveBeenCalled()
  })

  it('propagates MCP service authorization errors without route-level token rollback choreography', async () => {
    mocks.createUserMcpToken.mockResolvedValue({ ok: false, error: 'mcp_user_disallowed' })

    const response = await POST(createPostRequest({ name: 'MCP', expiresInDays: 30 }), routeContext())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'mcp_user_disallowed' })
  })

  it('revokes only slug-owned tokens from the slug token route', async () => {
    const response = await DELETE(new Request('https://example.com'), routeContext({ id: 'pat-2' }))

    expect(response.status).toBe(200)
    expect(mocks.revokeUserMcpToken).toHaveBeenCalledWith({ actor: mocks.user, slug: 'alice', tokenId: 'pat-2' })
  })

  it('returns server error when strict token revocation audit persistence fails', async () => {
    mocks.revokeUserMcpToken.mockResolvedValue({ ok: false, error: 'write_failed' })

    const response = await DELETE(new Request('https://example.com'), routeContext({ id: 'pat-2' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'write_failed' })
  })

  it('does not allow admins to use a user slug route as an all-user token boundary', async () => {
    mocks.user.role = 'ADMIN'
    mocks.listUserMcpTokens.mockResolvedValue({ ok: false, error: 'forbidden' })

    const response = await GET(new Request('https://example.com'), routeContext())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })
})

function createPostRequest(body: unknown): Request {
  return new Request('https://example.com/api/u/alice/mcp/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function routeContext(input: { id?: string } = {}): { params: Promise<{ slug: string; id?: string }> } {
  return { params: Promise.resolve({ slug: 'alice', ...input }) }
}

function createTokenRecord(input: { user?: { id: string; email: string; slug: string } } = {}) {
  return {
    id: 'pat-1',
    name: 'MCP',
    scopes: ['kb:read'],
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...input,
  }
}

function serializeTokenRecord() {
  return {
    id: 'pat-1',
    name: 'MCP',
    scopes: ['kb:read'],
    expiresAt: '2026-02-01T00:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}
