import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHash = vi.fn<(password: string) => Promise<string>>()
vi.mock('argon2', () => ({
  default: {
    hash: (password: string) => mockHash(password),
  },
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
}))
vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/runtime/session', () => ({
  getSession: () => mockGetSession(),
}))

const mockFindById = vi.fn()
const mockUpdatePasswordHash = vi.fn()
const mockRevokeByUserIdExceptSession = vi.fn()
vi.mock('@/lib/services', () => ({
  sessionService: {
    revokeByUserIdExceptSession: (userId: string, sessionId: string) =>
      mockRevokeByUserIdExceptSession(userId, sessionId),
  },
  userService: {
    findById: (id: string) => mockFindById(id),
    updatePasswordHash: (id: string, passwordHash: string) => mockUpdatePasswordHash(id, passwordHash),
  },
}))

import { changePassword } from '../actions'

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
