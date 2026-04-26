import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockHash,
  mockAuditEvent,
  mockVerifyPassword,
  mockGetRuntimeCapabilities,
  mockGetSession,
  mockUserService,
  mockSessionService,
  mockGenerateSecret,
  mockEncryptSecret,
  mockDecryptSecret,
  mockGenerateTotpUri,
  mockVerifyTotp,
  mockGenerateRecoveryCodes,
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
  mockGenerateSecret: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockGenerateTotpUri: vi.fn(),
  mockVerifyTotp: vi.fn(),
  mockGenerateRecoveryCodes: vi.fn(),
}))

vi.mock('@/lib/argon2', () => ({ hashArgon2: mockHash }))
vi.mock('@/lib/auth', () => ({ auditEvent: mockAuditEvent, verifyPassword: mockVerifyPassword }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mockGetRuntimeCapabilities }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/services', () => ({
  sessionService: mockSessionService,
  userService: mockUserService,
}))
vi.mock('@/lib/totp', () => ({
  generateSecret: mockGenerateSecret,
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
  generateTotpUri: mockGenerateTotpUri,
  verifyTotp: mockVerifyTotp,
  generateRecoveryCodes: mockGenerateRecoveryCodes,
}))

import {
  changePassword,
  initiate2FASetup,
  verify2FASetup,
  disable2FA,
  regenerateRecoveryCodes,
  get2FAStatus,
} from '../actions'

const CAPS_ALL = { auth: true, twoFactor: true }
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
