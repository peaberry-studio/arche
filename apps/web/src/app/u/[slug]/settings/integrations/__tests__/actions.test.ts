import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  auditEvent: (args: unknown) => mockAuditEvent(args),
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

const mockCreatePat = vi.fn()
const mockRevokePat = vi.fn()
vi.mock('@/lib/services', () => ({
  patService: {
    create: (data: unknown) => mockCreatePat(data),
    revokeByIdAndUserId: (tokenId: string, userId: string) => mockRevokePat(tokenId, userId),
  },
}))

import {
  createPersonalAccessToken,
  revokePersonalAccessToken,
  setMcpEnabled,
} from '../actions'

describe('MCP integration actions', () => {
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
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'alice@example.com', slug: 'alice', role: 'USER' },
      sessionId: 'session-1',
    })
    mockReadMcpSettings.mockResolvedValue({
      ok: true,
      enabled: true,
      hash: 'settings-hash',
    })
    mockWriteMcpSettings.mockResolvedValue({
      ok: true,
      enabled: true,
      hash: 'next-settings-hash',
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
    mockRevokePat.mockResolvedValue({ count: 1 })
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

  it('updates global MCP settings for admins', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com', slug: 'admin', role: 'ADMIN' },
      sessionId: 'session-1',
    })

    const result = await setMcpEnabled(true)

    expect(result).toEqual({ ok: true, enabled: true })
    expect(mockWriteMcpSettings).toHaveBeenCalledWith(true, 'settings-hash')
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'mcp.settings_updated',
      metadata: { enabled: true },
    })
  })

  it('revokes tokens for the current user only', async () => {
    const result = await revokePersonalAccessToken('tok-1')

    expect(result).toEqual({ ok: true })
    expect(mockRevokePat).toHaveBeenCalledWith('tok-1', 'user-1')
  })
})
