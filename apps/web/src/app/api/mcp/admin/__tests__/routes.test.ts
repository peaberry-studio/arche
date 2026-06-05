import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestUser = {
  id: string
  email: string
  slug: string
  role: 'ADMIN' | 'USER'
}

const mocks = vi.hoisted(() => ({
  getAdminMcpSettings: vi.fn(),
  listAdminMcpTokens: vi.fn(),
  revokeAdminMcpToken: vi.fn(),
  setAdminMcpEnabled: vi.fn(),
  setAdminMcpUserAllowed: vi.fn(),
  user: { id: 'admin-1', email: 'admin@example.com', slug: 'admin', role: 'ADMIN' as 'ADMIN' | 'USER' },
}))

vi.mock('@/lib/runtime/with-auth', () => ({
  withGlobalAuth: (_options: unknown, handler: (request: Request, context: {
    user: TestUser
    sessionId: string
    params: { id?: string }
  }) => Promise<Response>) => async (request: Request, context: { params?: Promise<{ id?: string }> } = {}) => {
    const params = await (context.params ?? Promise.resolve({}))
    return handler(request, { user: mocks.user, sessionId: 'session-1', params })
  },
}))

vi.mock('@/lib/mcp/management-service', () => ({
  getAdminMcpSettings: mocks.getAdminMcpSettings,
  listAdminMcpTokens: mocks.listAdminMcpTokens,
  revokeAdminMcpToken: mocks.revokeAdminMcpToken,
  setAdminMcpEnabled: mocks.setAdminMcpEnabled,
  setAdminMcpUserAllowed: mocks.setAdminMcpUserAllowed,
}))

import { GET as GET_SETTINGS, PATCH as PATCH_SETTINGS } from '@/app/api/mcp/admin/settings/route'
import { GET as GET_TOKENS } from '@/app/api/mcp/admin/tokens/route'
import { DELETE as DELETE_TOKEN } from '@/app/api/mcp/admin/tokens/[id]/route'
import { PATCH as PATCH_USER } from '@/app/api/mcp/admin/users/[id]/route'

describe('/api/mcp/admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.role = 'ADMIN'
    mocks.getAdminMcpSettings.mockResolvedValue({ ok: true, enabled: true, mcpAllowed: true, users: [createUserAccess()] })
    mocks.listAdminMcpTokens.mockResolvedValue({ ok: true, tokens: [createTokenRecord({ user: { id: 'u1', email: 'alice@example.com', slug: 'alice' } })] })
    mocks.revokeAdminMcpToken.mockResolvedValue({ ok: true })
    mocks.setAdminMcpEnabled.mockResolvedValue({ ok: true, enabled: false, mcpAllowed: true, users: [createUserAccess()] })
    mocks.setAdminMcpUserAllowed.mockResolvedValue({ ok: true, user: createUserAccess({ mcpAllowed: false }) })
  })

  it('returns global settings and user eligibility from the admin settings route', async () => {
    const response = await GET_SETTINGS(new Request('https://example.com/api/mcp/admin/settings'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ enabled: true, mcpAllowed: true, users: [createUserAccess()] })
    expect(mocks.getAdminMcpSettings).toHaveBeenCalledWith({ actor: mocks.user })
  })

  it('updates the global MCP enabled flag through the admin settings route', async () => {
    const response = await PATCH_SETTINGS(jsonRequest({ enabled: false }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ enabled: false, mcpAllowed: true, users: [createUserAccess()] })
    expect(mocks.setAdminMcpEnabled).toHaveBeenCalledWith({ actor: mocks.user, enabled: false })
  })

  it('returns validation errors for non-object global settings bodies', async () => {
    const response = await PATCH_SETTINGS(jsonRequest(null))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_enabled' })
    expect(mocks.setAdminMcpEnabled).not.toHaveBeenCalled()
  })

  it('returns server error when strict global MCP audit persistence fails', async () => {
    mocks.setAdminMcpEnabled.mockResolvedValue({ ok: false, error: 'write_failed' })

    const response = await PATCH_SETTINGS(jsonRequest({ enabled: false }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'write_failed' })
  })

  it('updates user eligibility through the admin users route', async () => {
    const response = await PATCH_USER(jsonRequest({ mcpAllowed: false }), { params: Promise.resolve({ id: 'u1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ user: createUserAccess({ mcpAllowed: false }) })
    expect(mocks.setAdminMcpUserAllowed).toHaveBeenCalledWith({ actor: mocks.user, mcpAllowed: false, userId: 'u1' })
  })

  it('returns validation errors for non-object user eligibility bodies', async () => {
    const response = await PATCH_USER(jsonRequest(null), { params: Promise.resolve({ id: 'u1' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_mcp_allowed' })
    expect(mocks.setAdminMcpUserAllowed).not.toHaveBeenCalled()
  })

  it('returns server error when strict user eligibility audit persistence fails', async () => {
    mocks.setAdminMcpUserAllowed.mockResolvedValue({ ok: false, error: 'write_failed' })

    const response = await PATCH_USER(jsonRequest({ mcpAllowed: false }), { params: Promise.resolve({ id: 'u1' }) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'write_failed' })
  })

  it('lists all MCP tokens only from the admin token route', async () => {
    const response = await GET_TOKENS(new Request('https://example.com/api/mcp/admin/tokens'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ tokens: [serializeTokenRecord({ user: { id: 'u1', email: 'alice@example.com', slug: 'alice' } })] })
    expect(mocks.listAdminMcpTokens).toHaveBeenCalledWith({ actor: mocks.user })
  })

  it('revokes any MCP token only from the admin token route', async () => {
    const response = await DELETE_TOKEN(new Request('https://example.com/api/mcp/admin/tokens/pat-1'), { params: Promise.resolve({ id: 'pat-1' }) })

    expect(response.status).toBe(200)
    expect(mocks.revokeAdminMcpToken).toHaveBeenCalledWith({ actor: mocks.user, tokenId: 'pat-1' })
  })

  it('returns server error when strict admin token revocation audit persistence fails', async () => {
    mocks.revokeAdminMcpToken.mockResolvedValue({ ok: false, error: 'write_failed' })

    const response = await DELETE_TOKEN(new Request('https://example.com/api/mcp/admin/tokens/pat-1'), { params: Promise.resolve({ id: 'pat-1' }) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'write_failed' })
  })
})

function jsonRequest(body: unknown): Request {
  return new Request('https://example.com/api/mcp/admin/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createUserAccess(input: Partial<{ id: string; email: string; slug: string; role: string; mcpAllowed: boolean }> = {}) {
  return {
    id: 'u1',
    email: 'alice@example.com',
    slug: 'alice',
    role: 'USER',
    mcpAllowed: true,
    ...input,
  }
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

function serializeTokenRecord(input: { user?: { id: string; email: string; slug: string } } = {}) {
  return {
    id: 'pat-1',
    name: 'MCP',
    scopes: ['kb:read'],
    expiresAt: '2026-02-01T00:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...input,
  }
}
