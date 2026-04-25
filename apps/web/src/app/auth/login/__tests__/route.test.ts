import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  createSession: vi.fn(),
  getCookieDomain: vi.fn(() => undefined),
  shouldUseSecureCookies: vi.fn(() => false),
  verifyPassword: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 4, resetAt: Date.now() + 900_000 })),
  hashSessionToken: vi.fn((t: string) => `hashed:${t}`),
  newSessionToken: vi.fn(() => 'challenge-token-abc'),
  userService: {
    findLoginByEmail: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// vi.mock() declarations
// ---------------------------------------------------------------------------
vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
  createSession: mocks.createSession,
  getCookieDomain: mocks.getCookieDomain,
  SESSION_COOKIE_NAME: 'arche_session',
  shouldUseSecureCookies: mocks.shouldUseSecureCookies,
  verifyPassword: mocks.verifyPassword,
}))

vi.mock('@/lib/http', () => ({
  getClientIp: mocks.getClientIp,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
}))

vi.mock('@/lib/security', () => ({
  hashSessionToken: mocks.hashSessionToken,
  newSessionToken: mocks.newSessionToken,
}))

vi.mock('@/lib/services', () => ({
  userService: mocks.userService,
}))

import { pending2FAMap, POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FAKE_USER = {
  id: 'u-1',
  email: 'alice@example.com',
  slug: 'alice',
  role: 'USER',
  passwordHash: '$argon2id$hash',
  totpEnabled: false,
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeRawRequest(rawBody: string) {
  return new Request('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pending2FAMap.clear()
    mocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 900_000 })
  })

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('input validation', () => {
    it('returns 400 when email is missing', async () => {
      const res = await POST(makeRequest({ password: 'secret' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })

    it('returns 400 when password is missing', async () => {
      const res = await POST(makeRequest({ email: 'alice@example.com' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })

    it('returns 400 when body is not valid JSON', async () => {
      const res = await POST(makeRawRequest('{not valid'))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })

    it('returns 400 when email is empty string', async () => {
      const res = await POST(makeRequest({ email: '  ', password: 'secret' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })

    it('returns 400 when email is not a string', async () => {
      const res = await POST(makeRequest({ email: 123, password: 'secret' }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_request')
    })
  })

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      const resetAt = Date.now() + 60_000
      mocks.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt })

      const res = await POST(makeRequest({ email: 'alice@example.com', password: 'secret' }))
      const body = await res.json()

      expect(res.status).toBe(429)
      expect(body.error).toBe('rate_limited')
      expect(body.retryAfter).toBeGreaterThan(0)
    })

    it('passes ip and email to checkRateLimit', async () => {
      mocks.getClientIp.mockReturnValue('10.0.0.5')
      mocks.userService.findLoginByEmail.mockResolvedValue(null)

      await POST(makeRequest({ email: 'Alice@Example.com', password: 'wrong' }))

      expect(mocks.checkRateLimit).toHaveBeenCalledWith(
        'login:10.0.0.5:alice@example.com',
        5,
        15 * 60 * 1000,
      )
    })

    it('uses "unknown" when client IP is null', async () => {
      mocks.getClientIp.mockReturnValue(null)
      mocks.userService.findLoginByEmail.mockResolvedValue(null)

      await POST(makeRequest({ email: 'test@example.com', password: 'x' }))

      expect(mocks.checkRateLimit).toHaveBeenCalledWith(
        'login:unknown:test@example.com',
        expect.any(Number),
        expect.any(Number),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Authentication failure
  // -------------------------------------------------------------------------
  describe('invalid credentials', () => {
    it('returns 401 when user is not found', async () => {
      mocks.userService.findLoginByEmail.mockResolvedValue(null)

      const res = await POST(makeRequest({ email: 'nobody@example.com', password: 'x' }))
      const body = await res.json()

      expect(res.status).toBe(401)
      expect(body.error).toBe('invalid_credentials')
      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login.failed', metadata: { email: 'nobody@example.com' } }),
      )
    })

    it('returns 401 when password is wrong', async () => {
      mocks.userService.findLoginByEmail.mockResolvedValue(FAKE_USER)
      mocks.verifyPassword.mockResolvedValue(false)

      const res = await POST(makeRequest({ email: 'alice@example.com', password: 'wrong' }))
      const body = await res.json()

      expect(res.status).toBe(401)
      expect(body.error).toBe('invalid_credentials')
      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'u-1', action: 'auth.login.failed' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Successful login (no 2FA)
  // -------------------------------------------------------------------------
  describe('successful login without 2FA', () => {
    const sessionExpiresAt = new Date('2026-05-01T00:00:00Z')

    beforeEach(() => {
      mocks.userService.findLoginByEmail.mockResolvedValue(FAKE_USER)
      mocks.verifyPassword.mockResolvedValue(true)
      mocks.createSession.mockResolvedValue({ token: 'session-tok-123', expiresAt: sessionExpiresAt })
    })

    it('returns ok with user data and sets session cookie', async () => {
      const res = await POST(makeRequest({ email: 'alice@example.com', password: 'correct' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.requires2FA).toBe(false)
      expect(body.user).toEqual({ id: 'u-1', email: 'alice@example.com', slug: 'alice', role: 'USER' })
    })

    it('sets the session cookie with correct attributes', async () => {
      mocks.getCookieDomain.mockReturnValue('.example.com')
      mocks.shouldUseSecureCookies.mockReturnValue(true)

      const res = await POST(makeRequest({ email: 'alice@example.com', password: 'correct' }))

      const cookie = res.cookies.get('arche_session')
      expect(cookie).toBeDefined()
      expect(cookie!.value).toBe('session-tok-123')
      expect(cookie!.httpOnly).toBe(true)
      expect(cookie!.sameSite).toBe('lax')
      expect(cookie!.secure).toBe(true)
      expect(cookie!.path).toBe('/')
      expect(cookie!.domain).toBe('.example.com')
    })

    it('audits a successful login event', async () => {
      await POST(makeRequest({ email: 'alice@example.com', password: 'correct' }))

      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'u-1', action: 'auth.login.succeeded' }),
      )
    })

    it('normalizes the email to lowercase and trims whitespace', async () => {
      await POST(makeRequest({ email: '  ALICE@Example.COM  ', password: 'correct' }))

      expect(mocks.userService.findLoginByEmail).toHaveBeenCalledWith('alice@example.com')
    })
  })

  // -------------------------------------------------------------------------
  // 2FA challenge issued
  // -------------------------------------------------------------------------
  describe('login with 2FA enabled', () => {
    const totpUser = { ...FAKE_USER, totpEnabled: true }

    beforeEach(() => {
      mocks.userService.findLoginByEmail.mockResolvedValue(totpUser)
      mocks.verifyPassword.mockResolvedValue(true)
    })

    it('returns requires2FA=true with a challengeToken', async () => {
      const res = await POST(makeRequest({ email: 'alice@example.com', password: 'correct' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.requires2FA).toBe(true)
      expect(body.challengeToken).toBe('challenge-token-abc')
    })

    it('stores the challenge in pending2FAMap', async () => {
      await POST(makeRequest({ email: 'alice@example.com', password: 'correct' }))

      const entry = pending2FAMap.get('hashed:challenge-token-abc')
      expect(entry).toBeDefined()
      expect(entry!.userId).toBe('u-1')
      expect(entry!.expiresAt).toBeGreaterThan(Date.now())
    })

    it('does not create a session', async () => {
      await POST(makeRequest({ email: 'alice@example.com', password: 'correct' }))

      expect(mocks.createSession).not.toHaveBeenCalled()
    })

    it('audits the 2FA challenge event', async () => {
      await POST(makeRequest({ email: 'alice@example.com', password: 'correct' }))

      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'u-1', action: 'auth.2fa.challenge_issued' }),
      )
    })
  })
})
