import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auditEventCreate: vi.fn(),
  findManyByUserId: vi.fn(),
  findManyWithUsers: vi.fn(),
  generatePat: vi.fn(() => 'arche_pat_secret'),
  generatePatSalt: vi.fn(() => 'salt-1'),
  getSettings: vi.fn(),
  hashPat: vi.fn(() => 'token-hash'),
  hashPatLookup: vi.fn(() => 'lookup-hash'),
  isUserAllowed: vi.fn(),
  listUserAccess: vi.fn(),
  personalAccessTokenCreate: vi.fn(),
  revokeAllActiveByUserId: vi.fn(),
  revokeById: vi.fn(),
  revokeByIdAndUserId: vi.fn(),
  setEnabled: vi.fn(),
  setUserAllowed: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/mcp/pat', () => ({
  generatePat: mocks.generatePat,
  generatePatSalt: mocks.generatePatSalt,
  hashPat: mocks.hashPat,
  hashPatLookup: mocks.hashPatLookup,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/services', () => ({
  auditService: {
    createEvent: mocks.auditEventCreate,
    createEventStrict: async (args: unknown, tx: { auditEvent: { create: (input: unknown) => Promise<unknown> } }) => tx.auditEvent.create({
      data: args && typeof args === 'object'
        ? {
            action: 'action' in args ? args.action : undefined,
            actorUserId: 'actorUserId' in args ? args.actorUserId : undefined,
            metadata: 'metadata' in args ? args.metadata : undefined,
          }
        : {},
    }),
  },
  mcpSettingsService: {
    getSettings: mocks.getSettings,
    isUserAllowed: mocks.isUserAllowed,
    listUserAccess: mocks.listUserAccess,
    setEnabled: mocks.setEnabled,
    setUserAllowed: mocks.setUserAllowed,
  },
  patService: {
    findManyByUserId: mocks.findManyByUserId,
    findManyWithUsers: mocks.findManyWithUsers,
    revokeAllActiveByUserId: mocks.revokeAllActiveByUserId,
    revokeById: mocks.revokeById,
    revokeByIdAndUserId: mocks.revokeByIdAndUserId,
  },
}))

import {
  createUserMcpToken,
  listAdminMcpTokens,
  listUserMcpTokens,
  revokeAdminMcpToken,
  revokeUserMcpToken,
  setAdminMcpEnabled,
  setAdminMcpUserAllowed,
} from '@/lib/mcp/management-service'

const user = { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER' }
const admin = { id: 'admin-1', email: 'admin@example.com', slug: 'admin', role: 'ADMIN' }

describe('MCP management service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockResolvedValue({ enabled: true })
    mocks.isUserAllowed.mockResolvedValue(true)
    mocks.listUserAccess.mockResolvedValue([createUserAccess()])
    mocks.personalAccessTokenCreate.mockResolvedValue(createTokenRecord())
    mocks.auditEventCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.revokeAllActiveByUserId.mockResolvedValue({ count: 0 })
    mocks.revokeById.mockResolvedValue({ count: 1 })
    mocks.revokeByIdAndUserId.mockResolvedValue({ count: 1 })
    mocks.setEnabled.mockResolvedValue({ enabled: false })
    mocks.setUserAllowed.mockResolvedValue(createUserAccess({ mcpAllowed: false }))
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      auditEvent: { create: mocks.auditEventCreate },
      mcpSettings: { upsert: vi.fn() },
      personalAccessToken: { create: mocks.personalAccessTokenCreate },
      user: { update: vi.fn() },
    }))
  })

  it('creates a PAT and strict audit event in the same transaction', async () => {
    const result = await createUserMcpToken({
      actor: user,
      expiresInDays: 30,
      name: 'MCP',
      scopes: ['kb:read'],
      slug: 'alice',
    })

    expect(result).toEqual({ ok: true, token: 'arche_pat_secret', record: createTokenRecord() })
    expect(mocks.transaction).toHaveBeenCalled()
    expect(mocks.personalAccessTokenCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lookupHash: 'lookup-hash', tokenHash: 'token-hash' }),
    }))
    expect(mocks.auditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'mcp.token_created',
        actorUserId: 'u1',
        metadata: { tokenId: 'pat-1', scopes: ['kb:read'] },
      }),
    })
  })

  it('does not return a one-time PAT when strict audit persistence fails', async () => {
    mocks.auditEventCreate.mockRejectedValue(new Error('audit_failed'))

    const result = await createUserMcpToken({
      actor: user,
      expiresInDays: 30,
      name: 'MCP',
      scopes: ['kb:read'],
      slug: 'alice',
    })

    expect(result).toEqual({ ok: false, error: 'write_failed' })
    expect(mocks.personalAccessTokenCreate).toHaveBeenCalled()
    expect(mocks.revokeById).not.toHaveBeenCalled()
  })

  it('keeps slug token listing user-owned even for admins', async () => {
    const result = await listUserMcpTokens({ actor: admin, slug: 'alice' })

    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(mocks.findManyWithUsers).not.toHaveBeenCalled()
  })

  it('lists all tokens only through the admin API service boundary', async () => {
    mocks.findManyWithUsers.mockResolvedValue([createTokenRecord({ user: { id: 'u1', email: 'alice@example.com', slug: 'alice' } })])

    const result = await listAdminMcpTokens({ actor: admin })

    expect(result).toEqual({ ok: true, tokens: [createTokenRecord({ user: { id: 'u1', email: 'alice@example.com', slug: 'alice' } })] })
    expect(mocks.findManyWithUsers).toHaveBeenCalled()
  })

  it('scopes slug token revocation to the owning user', async () => {
    const result = await revokeUserMcpToken({ actor: user, slug: 'alice', tokenId: 'pat-1' })

    expect(result).toEqual({ ok: true })
    expect(mocks.revokeByIdAndUserId).toHaveBeenCalledWith('pat-1', 'u1', expect.anything())
    expect(mocks.auditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'mcp.token_revoked',
        actorUserId: 'u1',
        metadata: { tokenId: 'pat-1' },
      }),
    })
    expect(mocks.revokeById).not.toHaveBeenCalled()
  })

  it('does not revoke a user token when strict audit persistence fails', async () => {
    mocks.auditEventCreate.mockRejectedValue(new Error('audit_failed'))

    const result = await revokeUserMcpToken({ actor: user, slug: 'alice', tokenId: 'pat-1' })

    expect(result).toEqual({ ok: false, error: 'write_failed' })
    expect(mocks.revokeByIdAndUserId).toHaveBeenCalledWith('pat-1', 'u1', expect.anything())
  })

  it('updates global MCP enablement and audit event in one transaction', async () => {
    const result = await setAdminMcpEnabled({ actor: admin, enabled: false })

    expect(result).toEqual({ ok: true, enabled: false, mcpAllowed: true, users: [createUserAccess()] })
    expect(mocks.setEnabled).toHaveBeenCalledWith(false, expect.anything())
    expect(mocks.auditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'mcp.disabled',
        actorUserId: 'admin-1',
      }),
    })
  })

  it('returns write_failed when global MCP enablement audit persistence fails', async () => {
    mocks.auditEventCreate.mockRejectedValue(new Error('audit_failed'))

    const result = await setAdminMcpEnabled({ actor: admin, enabled: true })

    expect(result).toEqual({ ok: false, error: 'write_failed' })
    expect(mocks.setEnabled).toHaveBeenCalledWith(true, expect.anything())
    expect(mocks.listUserAccess).not.toHaveBeenCalled()
  })

  it('updates MCP user eligibility and audit event in one transaction', async () => {
    const result = await setAdminMcpUserAllowed({ actor: admin, mcpAllowed: false, userId: 'u1' })

    expect(result).toEqual({ ok: true, user: createUserAccess({ mcpAllowed: false }) })
    expect(mocks.setUserAllowed).toHaveBeenCalledWith('u1', false, expect.anything())
    expect(mocks.auditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'mcp.user_disallowed',
        actorUserId: 'admin-1',
        metadata: { userId: 'u1', userSlug: 'alice' },
      }),
    })
  })

  it('revokes admin-selected MCP tokens and audit event in one transaction', async () => {
    const result = await revokeAdminMcpToken({ actor: admin, tokenId: 'pat-1' })

    expect(result).toEqual({ ok: true })
    expect(mocks.revokeById).toHaveBeenCalledWith('pat-1', expect.anything())
    expect(mocks.auditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'mcp.admin_token_revoked',
        actorUserId: 'admin-1',
        metadata: { tokenId: 'pat-1' },
      }),
    })
  })
})

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
