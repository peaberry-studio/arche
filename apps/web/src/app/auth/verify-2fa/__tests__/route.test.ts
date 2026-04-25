import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  verifyArgon2: vi.fn(),
  auditEvent: vi.fn(),
  createSession: vi.fn(),
  getCookieDomain: vi.fn(() => undefined),
  shouldUseSecureCookies: vi.fn(() => false),
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 4, resetAt: Date.now() + 900_000 })),
  resetRateLimit: vi.fn(),
  hashSessionToken: vi.fn((t: string) => `hashed:${t}`),
  userService: {
    find2faById: vi.fn(),
    markRecoveryCodeUsed: vi.fn(),
    updateTotpLastUsedAt: vi.fn(),
  },
  decryptSecret: vi.fn(() => 'decrypted-secret'),
  verifyTotp: vi.fn(),
  pending2FAMap: new Map<string, { userId: string; expiresAt: number }>(),
}))

// ---------------------------------------------------------------------------
// vi.mock() declarations
// ---------------------------------------------------------------------------
vi.mock('@/lib/argon2', () => ({
  verifyArgon2: mocks.verifyArgon2,
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
  createSession: mocks.createSession,
  getCookieDomain: mocks.getCookieDomain,
  SESSION_COOKIE_NAME: 'arche_session',
  shouldUseSecureCookies: mocks.shouldUseSecureCookies,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  resetRateLimit: mocks.resetRateLimit,
}))

vi.mock('@/lib/security', () => ({
  hashSessionToken: mocks.hashSessionToken,
}))

vi.mock('@/lib/services', () => ({
  userService: mocks.userService,
}))

vi.mock('@/lib/totp', () => ({
  decryptSecret: mocks.decryptSecret,
  verifyTotp: mocks.verifyTotp,
}))

vi.mock('../../login/route', () => ({
  pending2FAMap: mocks.pending2FAMap,
}))

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FAKE_USER = {
  id: 'u-1',
  email: 'alice@example.com',
  slug: 'alice',
  role: 'USER',
  totpSecret: 'encrypted-secret',
  totpLastUsedAt: null as Date | null,
  twoFactorRecovery: [
    { id: 'rec-1', codeHash: '$argon2id$recovery1' },
    { id: 'rec-2', codeHash: '$argon2id$recovery2' },
  ],
}

function seedChallenge(token = 'tok-123', userId = 'u-1', ttlMs = 5 * 60 * 1000) {
  const hashed = `hashed:${token}`
  mocks.pending2FAMap.set(hashed, { userId, expiresAt: Date.now() + ttlMs })
  return hashed
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/auth/verify-2fa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeRawRequest(rawBody: string) {
  return new Request('http://localhost/auth/verify-2fa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  })
}

const SESSION_TOKEN = 'session-tok-xyz'
const SESSION_EXPIRES = new Date('2026-05-01T00:00:00Z')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /auth/verify-2fa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pending2FAMap.clear()
    mocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 900_000 })
    mocks.createSession.mockResolvedValue({ token: SESSION_TOKEN, expiresAt: SESSION_EXPIRES })
  })

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('input validation', () => {
    it('returns 400 when challengeToken is missing', async () => {
      const res = await POST(makeRequest({ code: '123456' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })

    it('returns 400 when code is missing', async () => {
      const res = await POST(makeRequest({ challengeToken: 'tok-123' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })

    it('returns 400 when body is not valid JSON', async () => {
      const res = await POST(makeRawRequest('{bad'))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })
  })

  // -------------------------------------------------------------------------
  // Challenge expiry / not found
  // -------------------------------------------------------------------------
  describe('challenge validation', () => {
    it('returns 401 when challenge token is not in the map', async () => {
      const res = await POST(makeRequest({ challengeToken: 'unknown', code: '123456' }))
      const body = await res.json()

      expect(res.status).toBe(401)
      expect(body.error).toBe('challenge_expired')
    })

    it('returns 401 when challenge has expired', async () => {
      // Seed a challenge that is already expired
      const hashed = `hashed:expired-tok`
      mocks.pending2FAMap.set(hashed, { userId: 'u-1', expiresAt: Date.now() - 1000 })

      const res = await POST(makeRequest({ challengeToken: 'expired-tok', code: '123456' }))
      const body = await res.json()

      expect(res.status).toBe(401)
      expect(body.error).toBe('challenge_expired')
      // The expired entry should be cleaned up
      expect(mocks.pending2FAMap.has(hashed)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      seedChallenge()
      const resetAt = Date.now() + 60_000
      mocks.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt })

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))
      const body = await res.json()

      expect(res.status).toBe(429)
      expect(body.error).toBe('rate_limited')
      expect(body.retryAfter).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // Invalid user state
  // -------------------------------------------------------------------------
  describe('invalid user state', () => {
    it('returns 400 when user is not found', async () => {
      seedChallenge()
      mocks.userService.find2faById.mockResolvedValue(null)

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_state')
    })

    it('returns 400 when user has no totpSecret', async () => {
      seedChallenge()
      mocks.userService.find2faById.mockResolvedValue({ ...FAKE_USER, totpSecret: null })

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_state')
    })

    it('cleans up the challenge from pending2FAMap on invalid state', async () => {
      const hashed = seedChallenge()
      mocks.userService.find2faById.mockResolvedValue(null)

      await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))

      expect(mocks.pending2FAMap.has(hashed)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // TOTP verification
  // -------------------------------------------------------------------------
  describe('TOTP code verification', () => {
    beforeEach(() => {
      seedChallenge()
      mocks.userService.find2faById.mockResolvedValue(FAKE_USER)
    })

    it('returns 401 when TOTP code is invalid', async () => {
      mocks.verifyTotp.mockReturnValue({ valid: false })

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: '000000' }))
      const body = await res.json()

      expect(res.status).toBe(401)
      expect(body.error).toBe('invalid_code')
      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'u-1',
          action: 'auth.2fa.verification_failed',
          metadata: { isRecoveryCode: false },
        }),
      )
    })

    it('returns 200 and creates session on valid TOTP code', async () => {
      const windowStart = new Date('2026-04-25T12:00:00Z')
      mocks.verifyTotp.mockReturnValue({ valid: true, windowStart })

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.user).toEqual({ id: 'u-1', email: 'alice@example.com', slug: 'alice', role: 'USER' })
    })

    it('decrypts the TOTP secret before verification', async () => {
      mocks.verifyTotp.mockReturnValue({ valid: true, windowStart: new Date() })

      await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))

      expect(mocks.decryptSecret).toHaveBeenCalledWith('encrypted-secret')
      expect(mocks.verifyTotp).toHaveBeenCalledWith('decrypted-secret', '123456', null)
    })

    it('updates totpLastUsedAt on successful TOTP verification', async () => {
      const windowStart = new Date('2026-04-25T12:00:00Z')
      mocks.verifyTotp.mockReturnValue({ valid: true, windowStart })

      await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))

      expect(mocks.userService.updateTotpLastUsedAt).toHaveBeenCalledWith('u-1', windowStart)
    })

    it('deletes challenge from pending2FAMap after success', async () => {
      mocks.verifyTotp.mockReturnValue({ valid: true, windowStart: new Date() })

      await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))

      expect(mocks.pending2FAMap.has('hashed:tok-123')).toBe(false)
    })

    it('resets the rate limit after successful verification', async () => {
      mocks.verifyTotp.mockReturnValue({ valid: true, windowStart: new Date() })

      await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))

      expect(mocks.resetRateLimit).toHaveBeenCalledWith('2fa:u-1')
    })

    it('sets the session cookie with correct attributes', async () => {
      mocks.verifyTotp.mockReturnValue({ valid: true, windowStart: new Date() })
      mocks.getCookieDomain.mockReturnValue('.example.com')
      mocks.shouldUseSecureCookies.mockReturnValue(true)

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))

      const cookie = res.cookies.get('arche_session')
      expect(cookie).toBeDefined()
      expect(cookie!.value).toBe(SESSION_TOKEN)
      expect(cookie!.httpOnly).toBe(true)
      expect(cookie!.sameSite).toBe('lax')
      expect(cookie!.secure).toBe(true)
      expect(cookie!.path).toBe('/')
      expect(cookie!.domain).toBe('.example.com')
    })

    it('audits a successful login via 2fa', async () => {
      mocks.verifyTotp.mockReturnValue({ valid: true, windowStart: new Date() })

      await POST(makeRequest({ challengeToken: 'tok-123', code: '123456' }))

      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'u-1',
          action: 'auth.login.succeeded',
          metadata: { via: '2fa' },
        }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Recovery code verification
  // -------------------------------------------------------------------------
  describe('recovery code verification', () => {
    beforeEach(() => {
      seedChallenge()
      mocks.userService.find2faById.mockResolvedValue(FAKE_USER)
    })

    it('returns 200 on valid recovery code', async () => {
      // First recovery code does not match, second does
      mocks.verifyArgon2.mockResolvedValueOnce(false)
      mocks.verifyArgon2.mockResolvedValueOnce(true)

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: 'ABCD-1234', isRecoveryCode: true }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
    })

    it('marks the used recovery code', async () => {
      mocks.verifyArgon2.mockResolvedValueOnce(true)

      await POST(makeRequest({ challengeToken: 'tok-123', code: 'abcd-1234', isRecoveryCode: true }))

      expect(mocks.userService.markRecoveryCodeUsed).toHaveBeenCalledWith('rec-1')
    })

    it('uppercases the recovery code before comparing', async () => {
      mocks.verifyArgon2.mockResolvedValueOnce(true)

      await POST(makeRequest({ challengeToken: 'tok-123', code: 'abcd-1234', isRecoveryCode: true }))

      expect(mocks.verifyArgon2).toHaveBeenCalledWith('$argon2id$recovery1', 'ABCD-1234')
    })

    it('audits recovery code usage with remaining count', async () => {
      mocks.verifyArgon2.mockResolvedValueOnce(true)

      await POST(makeRequest({ challengeToken: 'tok-123', code: 'ABCD-1234', isRecoveryCode: true }))

      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'u-1',
          action: 'auth.2fa.recovery_code_used',
          metadata: { remainingCodes: 1 },
        }),
      )
    })

    it('returns 401 when no recovery code matches', async () => {
      mocks.verifyArgon2.mockResolvedValue(false)

      const res = await POST(makeRequest({ challengeToken: 'tok-123', code: 'WRONG-CODE', isRecoveryCode: true }))
      const body = await res.json()

      expect(res.status).toBe(401)
      expect(body.error).toBe('invalid_code')
      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'u-1',
          action: 'auth.2fa.verification_failed',
          metadata: { isRecoveryCode: true },
        }),
      )
    })

    it('does not update totpLastUsedAt for recovery codes', async () => {
      mocks.verifyArgon2.mockResolvedValueOnce(true)

      await POST(makeRequest({ challengeToken: 'tok-123', code: 'ABCD-1234', isRecoveryCode: true }))

      expect(mocks.userService.updateTotpLastUsedAt).not.toHaveBeenCalled()
    })

    it('does not call verifyTotp when using recovery codes', async () => {
      mocks.verifyArgon2.mockResolvedValueOnce(true)

      await POST(makeRequest({ challengeToken: 'tok-123', code: 'ABCD-1234', isRecoveryCode: true }))

      expect(mocks.verifyTotp).not.toHaveBeenCalled()
    })
  })
})
