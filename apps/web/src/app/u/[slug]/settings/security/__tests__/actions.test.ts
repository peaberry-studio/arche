import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockHash,
  mockAuditEvent,
  mockVerifyPassword,
  mockGetRuntimeCapabilities,
  mockGetSession,
  mockUserService,
  mockSessionService,
  mockPatService,
  mockGenerateSecret,
  mockEncryptSecret,
  mockDecryptSecret,
  mockGenerateTotpUri,
  mockVerifyTotp,
  mockGenerateRecoveryCodes,
  mockGeneratePat,
  mockGeneratePatSalt,
  mockHashPat,
  mockHashPatLookup,
  mockReadMcpSettings,
  mockWriteMcpSettings,
} = vi.hoisted(() => ({
  mockHash: vi.fn(),
  mockAuditEvent: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockGetRuntimeCapabilities: vi.fn(),
  mockGetSession: vi.fn(),
  mockUserService: {
    findById: vi.fn(),
    updatePasswordHash: vi.fn(),
    updateTotpSecret: vi.fn(),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
    countUnusedRecoveryCodes: vi.fn(),
  },
  mockSessionService: {
    revokeByUserIdExceptSession: vi.fn(),
  },
  mockPatService: {
    create: vi.fn(),
  },
  mockGenerateSecret: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockGenerateTotpUri: vi.fn(),
  mockVerifyTotp: vi.fn(),
  mockGenerateRecoveryCodes: vi.fn(),
  mockGeneratePat: vi.fn(),
  mockGeneratePatSalt: vi.fn(),
  mockHashPat: vi.fn(),
  mockHashPatLookup: vi.fn(),
  mockReadMcpSettings: vi.fn(),
  mockWriteMcpSettings: vi.fn(),
}))

vi.mock('@/lib/argon2', () => ({ hashArgon2: mockHash }))
vi.mock('@/lib/auth', () => ({ auditEvent: mockAuditEvent, verifyPassword: mockVerifyPassword }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mockGetRuntimeCapabilities }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/services', () => ({
  sessionService: mockSessionService,
  userService: mockUserService,
  patService: mockPatService,
}))
vi.mock('@/lib/totp', () => ({
  generateSecret: mockGenerateSecret,
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
  generateTotpUri: mockGenerateTotpUri,
  verifyTotp: mockVerifyTotp,
  generateRecoveryCodes: mockGenerateRecoveryCodes,
}))
vi.mock('@/lib/mcp/pat', () => ({
  generatePat: mockGeneratePat,
  generatePatSalt: mockGeneratePatSalt,
  hashPat: mockHashPat,
  hashPatLookup: mockHashPatLookup,
}))
vi.mock('@/lib/mcp/settings', () => ({
  readMcpSettings: mockReadMcpSettings,
  writeMcpSettings: mockWriteMcpSettings,
}))

import {
  changePassword,
  initiate2FASetup,
  verify2FASetup,
  disable2FA,
  regenerateRecoveryCodes,
  get2FAStatus,
  createPersonalAccessToken,
} from '../actions'

const CAPS_ALL = { auth: true, twoFactor: true, mcp: true }
const TEST_USER = {
  id: 'user-1',
  email: 'alice@example.com',
  passwordHash: 'stored-hash',
  totpEnabled: false,
  totpSecret: null,
  totpVerifiedAt: null,
}
const TEST_SESSION = {
  user: { id: 'user-1', email: 'alice@example.com', slug: 'alice', role: 'USER' },
  sessionId: 'session-1',
}

describe('changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue(CAPS_ALL)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockUserService.findById.mockResolvedValue({ ...TEST_USER })
    mockVerifyPassword.mockResolvedValue(true)
    mockHash.mockResolvedValue('new-hash')
  })

  it('returns invalid_current_password when the current password does not verify', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const result = await changePassword('wrong-password', 'new-password-123', 'new-password-123')
    expect(result).toEqual({
      ok: false,
      error: 'invalid_current_password',
      message: 'Current password is incorrect',
    })
    expect(mockUserService.updatePasswordHash).not.toHaveBeenCalled()
    expect(mockSessionService.revokeByUserIdExceptSession).not.toHaveBeenCalled()
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
  })

  it('hashes, persists, and audits the new password on success', async () => {
    const result = await changePassword('current-password', 'new-password-123', 'new-password-123')
    expect(result).toEqual({ ok: true })
    expect(mockHash).toHaveBeenCalledWith('new-password-123')
    expect(mockUserService.updatePasswordHash).toHaveBeenCalledWith('user-1', 'new-hash')
    expect(mockSessionService.revokeByUserIdExceptSession).toHaveBeenCalledWith('user-1', 'session-1')
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'auth.password.changed',
    })
  })

  it('returns error when auth is unavailable', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ auth: false })
    const result = await changePassword('old', 'new', 'new')
    expect(result).toMatchObject({ error: 'password_change_unavailable' })
  })

  it('returns error for empty current password', async () => {
    const result = await changePassword('', 'new', 'new')
    expect(result).toMatchObject({ error: 'invalid_current_password' })
  })

  it('returns error for empty new password', async () => {
    const result = await changePassword('old', '', 'confirm')
    expect(result).toMatchObject({ error: 'invalid_new_password' })
  })

  it('returns error for empty confirmation', async () => {
    const result = await changePassword('old', 'new', '')
    expect(result).toMatchObject({ error: 'invalid_new_password' })
  })

  it('returns error when new equals current', async () => {
    const result = await changePassword('same', 'same', 'same')
    expect(result).toMatchObject({ error: 'invalid_new_password' })
  })

  it('returns error when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await changePassword('old', 'new', 'new')
    expect(result).toMatchObject({ error: 'not_authenticated' })
  })

  it('returns error when user not found', async () => {
    mockUserService.findById.mockResolvedValue(null)
    const result = await changePassword('old', 'new', 'new')
    expect(result).toMatchObject({ error: 'user_not_found' })
  })
})

describe('initiate2FASetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue(CAPS_ALL)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockUserService.findById.mockResolvedValue({ ...TEST_USER })
    mockGenerateSecret.mockReturnValue('SECRETBASE32')
    mockEncryptSecret.mockReturnValue('encrypted')
    mockGenerateTotpUri.mockReturnValue('otpauth://totp/...')
  })

  it('generates secret and QR URI', async () => {
    const result = await initiate2FASetup()
    expect(result).toEqual({ ok: true, qrUri: 'otpauth://totp/...', secret: 'SECRETBASE32' })
    expect(mockUserService.updateTotpSecret).toHaveBeenCalledWith('user-1', 'encrypted')
    expect(mockAuditEvent).toHaveBeenCalled()
  })

  it('returns error when 2FA unavailable', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ twoFactor: false })
    const result = await initiate2FASetup()
    expect(result.ok).toBe(false)
  })

  it('returns error when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await initiate2FASetup()
    expect(result.ok).toBe(false)
  })

  it('returns error when user not found', async () => {
    mockUserService.findById.mockResolvedValue(null)
    const result = await initiate2FASetup()
    expect(result.ok).toBe(false)
  })

  it('returns error when 2FA already enabled', async () => {
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpEnabled: true })
    const result = await initiate2FASetup()
    expect(result.ok).toBe(false)
  })
})

describe('verify2FASetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue(CAPS_ALL)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpSecret: 'enc-secret' })
    mockDecryptSecret.mockReturnValue('raw-secret')
    mockVerifyTotp.mockReturnValue({ valid: true })
    mockGenerateRecoveryCodes.mockReturnValue(['code1', 'code2'])
    mockHash.mockResolvedValue('$hashed-code$')
  })

  it('verifies code and enables 2FA', async () => {
    const result = await verify2FASetup('123456')
    expect(result).toEqual({ ok: true, recoveryCodes: ['code1', 'code2'] })
    expect(mockDecryptSecret).toHaveBeenCalledWith('enc-secret')
    expect(mockVerifyTotp).toHaveBeenCalledWith('raw-secret', '123456')
    expect(mockUserService.enableTwoFactor).toHaveBeenCalled()
    expect(mockAuditEvent).toHaveBeenCalledWith({ actorUserId: 'user-1', action: '2fa.enabled' })
  })

  it('returns error for invalid code', async () => {
    mockVerifyTotp.mockReturnValue({ valid: false })
    const result = await verify2FASetup('000000')
    expect(result.ok).toBe(false)
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: '2fa.setup_verification_failed',
    })
  })

  it('returns error when setup not initiated', async () => {
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpSecret: null })
    const result = await verify2FASetup('123456')
    expect(result.ok).toBe(false)
  })

  it('returns error when already enabled', async () => {
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpEnabled: true })
    const result = await verify2FASetup('123456')
    expect(result.ok).toBe(false)
  })

  it('returns error when 2FA unavailable', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ twoFactor: false })
    const result = await verify2FASetup('123456')
    expect(result.ok).toBe(false)
  })

  it('returns error when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await verify2FASetup('123456')
    expect(result.ok).toBe(false)
  })
})

describe('disable2FA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue(CAPS_ALL)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpEnabled: true })
    mockVerifyPassword.mockResolvedValue(true)
  })

  it('disables 2FA with valid password', async () => {
    const result = await disable2FA('password')
    expect(result).toEqual({ ok: true })
    expect(mockUserService.disableTwoFactor).toHaveBeenCalledWith('user-1')
    expect(mockAuditEvent).toHaveBeenCalledWith({ actorUserId: 'user-1', action: '2fa.disabled' })
  })

  it('returns error for wrong password', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const result = await disable2FA('wrong')
    expect(result.ok).toBe(false)
  })

  it('returns error when 2FA not enabled', async () => {
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpEnabled: false })
    const result = await disable2FA('password')
    expect(result.ok).toBe(false)
  })

  it('returns error when 2FA unavailable', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ twoFactor: false })
    const result = await disable2FA('password')
    expect(result.ok).toBe(false)
  })

  it('returns error when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await disable2FA('password')
    expect(result.ok).toBe(false)
  })

  it('returns error when user not found', async () => {
    mockUserService.findById.mockResolvedValue(null)
    const result = await disable2FA('password')
    expect(result.ok).toBe(false)
  })
})

describe('regenerateRecoveryCodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue(CAPS_ALL)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpEnabled: true })
    mockVerifyPassword.mockResolvedValue(true)
    mockGenerateRecoveryCodes.mockReturnValue(['r1', 'r2'])
    mockHash.mockResolvedValue('$hashed$')
  })

  it('regenerates codes with valid password', async () => {
    const result = await regenerateRecoveryCodes('password')
    expect(result).toEqual({ ok: true, recoveryCodes: ['r1', 'r2'] })
    expect(mockUserService.regenerateRecoveryCodes).toHaveBeenCalled()
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: '2fa.recovery_codes_regenerated',
    })
  })

  it('returns error for empty password', async () => {
    const result = await regenerateRecoveryCodes('')
    expect(result.ok).toBe(false)
  })

  it('returns error when 2FA not enabled', async () => {
    mockUserService.findById.mockResolvedValue({ ...TEST_USER, totpEnabled: false })
    const result = await regenerateRecoveryCodes('password')
    expect(result.ok).toBe(false)
  })

  it('returns error for wrong password', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const result = await regenerateRecoveryCodes('wrong')
    expect(result.ok).toBe(false)
  })

  it('returns error when 2FA unavailable', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ twoFactor: false })
    const result = await regenerateRecoveryCodes('password')
    expect(result.ok).toBe(false)
  })

  it('returns error when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await regenerateRecoveryCodes('password')
    expect(result.ok).toBe(false)
  })

  it('returns error when user not found', async () => {
    mockUserService.findById.mockResolvedValue(null)
    const result = await regenerateRecoveryCodes('password')
    expect(result.ok).toBe(false)
  })
})

describe('get2FAStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue(CAPS_ALL)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockUserService.findById.mockResolvedValue({
      ...TEST_USER,
      totpEnabled: true,
      totpVerifiedAt: new Date('2026-01-01'),
    })
    mockUserService.countUnusedRecoveryCodes.mockResolvedValue(8)
  })

  it('returns 2FA status', async () => {
    const result = await get2FAStatus()
    expect(result).toEqual({
      ok: true,
      enabled: true,
      verifiedAt: new Date('2026-01-01'),
      recoveryCodesRemaining: 8,
    })
  })

  it('returns error when 2FA unavailable', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ twoFactor: false })
    const result = await get2FAStatus()
    expect(result.ok).toBe(false)
  })

  it('returns error when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await get2FAStatus()
    expect(result.ok).toBe(false)
  })

  it('returns error when user not found', async () => {
    mockUserService.findById.mockResolvedValue(null)
    const result = await get2FAStatus()
    expect(result.ok).toBe(false)
  })
})

describe('createPersonalAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue(CAPS_ALL)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockReadMcpSettings.mockResolvedValue({
      ok: true,
      enabled: true,
      hash: 'settings-hash',
    })
    mockGeneratePat.mockReturnValue('arche_pat_123')
    mockGeneratePatSalt.mockReturnValue('salt-123')
    mockHashPatLookup.mockReturnValue('lookup-123')
    mockHashPat.mockReturnValue('token-hash-123')
    mockPatService.create.mockResolvedValue({
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

    expect(mockPatService.create).toHaveBeenCalledWith({
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

    expect(mockPatService.create).not.toHaveBeenCalled()
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

    expect(mockPatService.create).not.toHaveBeenCalled()
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

    expect(mockPatService.create).not.toHaveBeenCalled()
  })
})
