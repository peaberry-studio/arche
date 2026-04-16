import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHash = vi.fn<(password: string) => Promise<string>>()
vi.mock('@/lib/argon2', () => ({
  hashArgon2: (password: string) => mockHash(password),
}))

const mockAuditEvent = vi.fn()
const mockVerifyPassword = vi.fn()
vi.mock('@/lib/auth', () => ({
  auditEvent: (args: unknown) => mockAuditEvent(args),
  verifyPassword: (password: string, passwordHash: string) => mockVerifyPassword(password, passwordHash),
}))

const mockGetRuntimeCapabilities = vi.fn(() => ({
  multiUser: true,
  auth: true,
  containers: true,
  workspaceAgent: true,
  reaper: true,
  csrf: true,
  twoFactor: true,
  teamManagement: true,
  connectors: true,
  kickstart: true,
  autopilot: true,
  mcp: true,
}))
vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/runtime/session', () => ({
  getSession: () => mockGetSession(),
}))

const mockGeneratePat = vi.fn()
const mockGeneratePatSalt = vi.fn()
const mockHashPat = vi.fn()
const mockHashPatLookup = vi.fn()
vi.mock('@/lib/mcp/pat', () => ({
  generatePat: () => mockGeneratePat(),
  generatePatSalt: () => mockGeneratePatSalt(),
  hashPat: (token: string, salt: string) => mockHashPat(token, salt),
  hashPatLookup: (token: string) => mockHashPatLookup(token),
}))

const mockReadMcpSettings = vi.fn()
const mockWriteMcpSettings = vi.fn()
vi.mock('@/lib/mcp/settings', () => ({
  readMcpSettings: () => mockReadMcpSettings(),
  writeMcpSettings: (enabled: boolean, expectedHash?: string) => mockWriteMcpSettings(enabled, expectedHash),
}))

const mockFindById = vi.fn()
const mockCreatePat = vi.fn()
const mockUpdatePasswordHash = vi.fn()
const mockRevokeByUserIdExceptSession = vi.fn()
vi.mock('@/lib/services', () => ({
  patService: {
    create: (data: unknown) => mockCreatePat(data),
  },
  sessionService: {
    revokeByUserIdExceptSession: (userId: string, sessionId: string) =>
      mockRevokeByUserIdExceptSession(userId, sessionId),
  },
  userService: {
    findById: (id: string) => mockFindById(id),
    updatePasswordHash: (id: string, passwordHash: string) => mockUpdatePasswordHash(id, passwordHash),
  },
}))

import {
  changePassword,
  createPersonalAccessToken,
} from '../actions'

describe('changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: true,
      auth: true,
      containers: true,
      workspaceAgent: true,
      reaper: true,
      csrf: true,
      twoFactor: true,
      teamManagement: true,
      connectors: true,
      kickstart: true,
      autopilot: true,
      mcp: true,
    })
  })

  it('returns invalid_current_password when the current password does not verify', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'alice@example.com', slug: 'alice', role: 'USER' },
      sessionId: 'session-1',
    })
    mockFindById.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'stored-hash',
    })
    mockVerifyPassword.mockResolvedValue(false)

    const result = await changePassword('wrong-password', 'new-password-123', 'new-password-123')

    expect(result).toEqual({
      ok: false,
      error: 'invalid_current_password',
      message: 'Current password is incorrect',
    })
    expect(mockUpdatePasswordHash).not.toHaveBeenCalled()
    expect(mockRevokeByUserIdExceptSession).not.toHaveBeenCalled()
    expect(mockAuditEvent).not.toHaveBeenCalled()
  })

  it('returns invalid_new_password when the new password confirmation does not match', async () => {
    const result = await changePassword('current-password', 'new-password-123', 'different-password')

    expect(result).toEqual({
      ok: false,
      error: 'invalid_new_password',
      message: 'New password confirmation does not match',
    })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockUpdatePasswordHash).not.toHaveBeenCalled()
    expect(mockRevokeByUserIdExceptSession).not.toHaveBeenCalled()
  })

  it('hashes, persists, and audits the new password on success', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'alice@example.com', slug: 'alice', role: 'USER' },
      sessionId: 'session-1',
    })
    mockFindById.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'stored-hash',
    })
    mockVerifyPassword.mockResolvedValue(true)
    mockHash.mockResolvedValue('new-hash')
    mockUpdatePasswordHash.mockResolvedValue(undefined)
    mockRevokeByUserIdExceptSession.mockResolvedValue(undefined)

    const result = await changePassword('current-password', 'new-password-123', 'new-password-123')

    expect(result).toEqual({ ok: true })
    expect(mockHash).toHaveBeenCalledWith('new-password-123')
    expect(mockUpdatePasswordHash).toHaveBeenCalledWith('user-1', 'new-hash')
    expect(mockRevokeByUserIdExceptSession).toHaveBeenCalledWith('user-1', 'session-1')
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'auth.password.changed',
    })
  })
})

describe('createPersonalAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: true,
      auth: true,
      containers: true,
      workspaceAgent: true,
      reaper: true,
      csrf: true,
      twoFactor: true,
      teamManagement: true,
      connectors: true,
      kickstart: true,
      mcp: true,
    })
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'alice@example.com', slug: 'alice', role: 'USER' },
      sessionId: 'session-1',
    })
    mockReadMcpSettings.mockResolvedValue({
      ok: true,
      enabled: true,
      hash: 'settings-hash',
    })
    mockGeneratePat.mockReturnValue('arche_pat_123')
    mockGeneratePatSalt.mockReturnValue('salt-123')
    mockHashPatLookup.mockReturnValue('lookup-123')
    mockHashPat.mockReturnValue('token-hash-123')
    mockCreatePat.mockResolvedValue({
      id: 'tok-1',
      name: 'Laptop',
      scopes: ['agents:read'],
      createdAt: new Date('2026-04-12T10:00:00.000Z'),
      expiresAt: new Date('2026-05-12T10:00:00.000Z'),
      lastUsedAt: null,
      revokedAt: null,
    })
  })

  it('creates a token with the selected scopes', async () => {
    const result = await createPersonalAccessToken({
      name: 'Laptop',
      expiresInDays: 30,
      scopes: ['agents:read'],
    })

    expect(mockCreatePat).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'Laptop',
      lookupHash: 'lookup-123',
      tokenHash: 'token-hash-123',
      salt: 'salt-123',
      scopes: ['agents:read'],
      expiresAt: expect.any(Date),
    })
    expect(result).toEqual({
      ok: true,
      token: 'arche_pat_123',
      tokenRecord: {
        id: 'tok-1',
        name: 'Laptop',
        scopes: ['agents:read'],
        createdAt: '2026-04-12T10:00:00.000Z',
        expiresAt: '2026-05-12T10:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    })
  })

  it('uses the full default scope set when scopes are omitted', async () => {
    await createPersonalAccessToken({
      name: 'Laptop',
      expiresInDays: 30,
    })

    expect(mockCreatePat).toHaveBeenCalledWith(expect.objectContaining({
      scopes: ['agents:read', 'kb:read', 'kb:write', 'tasks:run'],
    }))
  })

  it('rejects token creation when MCP is disabled', async () => {
    mockReadMcpSettings.mockResolvedValue({
      ok: true,
      enabled: false,
      hash: 'settings-hash',
    })

    await expect(createPersonalAccessToken({
      name: 'Laptop',
      expiresInDays: 30,
      scopes: ['agents:read'],
    })).resolves.toEqual({
      ok: false,
      error: 'MCP is disabled',
    })

    expect(mockCreatePat).not.toHaveBeenCalled()
  })

  it('rejects empty scope selections', async () => {
    await expect(createPersonalAccessToken({
      name: 'Laptop',
      expiresInDays: 30,
      scopes: [],
    })).resolves.toEqual({
      ok: false,
      error: 'Select at least one MCP permission',
    })

    expect(mockCreatePat).not.toHaveBeenCalled()
  })

  it('rejects unknown scopes', async () => {
    await expect(createPersonalAccessToken({
      name: 'Laptop',
      expiresInDays: 30,
      scopes: ['admin:write'],
    })).resolves.toEqual({
      ok: false,
      error: 'Invalid token scopes',
    })

    expect(mockCreatePat).not.toHaveBeenCalled()
  })
})
