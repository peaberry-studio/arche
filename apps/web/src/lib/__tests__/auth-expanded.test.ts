import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockVerifyArgon2,
  mockGetClientIp,
  mockNewSessionToken,
  mockHashSessionToken,
  mockAuditService,
  mockSessionService,
} = vi.hoisted(() => ({
  mockVerifyArgon2: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockNewSessionToken: vi.fn(),
  mockHashSessionToken: vi.fn(),
  mockAuditService: { createEvent: vi.fn() },
  mockSessionService: {
    create: vi.fn(),
    revokeByTokenHash: vi.fn(),
    findByTokenHash: vi.fn(),
    touchLastSeen: vi.fn(),
  },
}))

vi.mock('@/lib/argon2', () => ({ verifyArgon2: mockVerifyArgon2 }))
vi.mock('@/lib/http', () => ({ getClientIp: mockGetClientIp }))
vi.mock('@/lib/security', () => ({
  newSessionToken: mockNewSessionToken,
  hashSessionToken: mockHashSessionToken,
}))
vi.mock('@/lib/services', () => ({
  auditService: mockAuditService,
  sessionService: mockSessionService,
}))

import {
  shouldUseSecureCookies,
  getCookieDomain,
  getSessionTtlDays,
  auditEvent,
  verifyPassword,
  createSession,
  revokeSession,
  getSessionFromToken,
  SESSION_COOKIE_NAME,
} from '@/lib/auth'

describe('SESSION_COOKIE_NAME', () => {
  it('equals arche_session', () => {
    expect(SESSION_COOKIE_NAME).toBe('arche_session')
  })
})

describe('shouldUseSecureCookies', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.ARCHE_COOKIE_SECURE
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns true when ARCHE_COOKIE_SECURE=true', () => {
    process.env.ARCHE_COOKIE_SECURE = 'true'
    expect(shouldUseSecureCookies()).toBe(true)
  })

  it('returns false when ARCHE_COOKIE_SECURE=false', () => {
    process.env.ARCHE_COOKIE_SECURE = 'false'
    expect(shouldUseSecureCookies()).toBe(false)
  })

  it('returns true when x-forwarded-proto is https', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https' })
    expect(shouldUseSecureCookies(headers)).toBe(true)
  })

  it('returns false when x-forwarded-proto is http', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'http' })
    expect(shouldUseSecureCookies(headers)).toBe(false)
  })

  it('handles comma-separated x-forwarded-proto', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https, http' })
    expect(shouldUseSecureCookies(headers)).toBe(true)
  })

  it('returns true in production when no env or header', () => {
    process.env.NODE_ENV = 'production'
    expect(shouldUseSecureCookies()).toBe(true)
  })

  it('returns false in development when no env or header', () => {
    process.env.NODE_ENV = 'development'
    expect(shouldUseSecureCookies()).toBe(false)
  })
})

describe('getCookieDomain', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.ARCHE_COOKIE_DOMAIN
    delete process.env.ARCHE_DOMAIN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns undefined in non-production', () => {
    process.env.NODE_ENV = 'development'
    expect(getCookieDomain()).toBeUndefined()
  })

  it('returns explicit domain when set', () => {
    process.env.NODE_ENV = 'production'
    process.env.ARCHE_COOKIE_DOMAIN = '.example.com'
    expect(getCookieDomain()).toBe('.example.com')
  })

  it('derives domain from ARCHE_DOMAIN with leading dot', () => {
    process.env.NODE_ENV = 'production'
    process.env.ARCHE_DOMAIN = 'example.com'
    expect(getCookieDomain()).toBe('.example.com')
  })

  it('strips existing leading dot from ARCHE_DOMAIN', () => {
    process.env.NODE_ENV = 'production'
    process.env.ARCHE_DOMAIN = '.example.com'
    expect(getCookieDomain()).toBe('.example.com')
  })

  it('returns undefined in production with no domain env vars', () => {
    process.env.NODE_ENV = 'production'
    expect(getCookieDomain()).toBeUndefined()
  })
})

describe('getSessionTtlDays', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns 7 by default', () => {
    delete process.env.ARCHE_SESSION_TTL_DAYS
    expect(getSessionTtlDays()).toBe(7)
  })

  it('parses valid integer', () => {
    process.env.ARCHE_SESSION_TTL_DAYS = '30'
    expect(getSessionTtlDays()).toBe(30)
  })

  it('floors float values', () => {
    process.env.ARCHE_SESSION_TTL_DAYS = '14.9'
    expect(getSessionTtlDays()).toBe(14)
  })

  it('returns 7 for zero', () => {
    process.env.ARCHE_SESSION_TTL_DAYS = '0'
    expect(getSessionTtlDays()).toBe(7)
  })

  it('returns 7 for negative', () => {
    process.env.ARCHE_SESSION_TTL_DAYS = '-5'
    expect(getSessionTtlDays()).toBe(7)
  })

  it('returns 7 for non-numeric', () => {
    process.env.ARCHE_SESSION_TTL_DAYS = 'abc'
    expect(getSessionTtlDays()).toBe(7)
  })
})

describe('auditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to auditService.createEvent', async () => {
    const args = { actorUserId: 'u1', action: 'test.action', metadata: { key: 'val' } }
    await auditEvent(args)
    expect(mockAuditService.createEvent).toHaveBeenCalledWith(args)
  })

  it('passes null actorUserId', async () => {
    await auditEvent({ actorUserId: null, action: 'system.event' })
    expect(mockAuditService.createEvent).toHaveBeenCalledWith({
      actorUserId: null,
      action: 'system.event',
    })
  })
})

describe('verifyPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to verifyArgon2 with swapped args', async () => {
    mockVerifyArgon2.mockResolvedValue(true)
    const result = await verifyPassword('secret', '$hash$')
    expect(mockVerifyArgon2).toHaveBeenCalledWith('$hash$', 'secret')
    expect(result).toBe(true)
  })

  it('returns false when verification fails', async () => {
    mockVerifyArgon2.mockResolvedValue(false)
    const result = await verifyPassword('wrong', '$hash$')
    expect(result).toBe(false)
  })
})

describe('createSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNewSessionToken.mockReturnValue('raw-token')
    mockHashSessionToken.mockReturnValue('hashed-token')
    mockGetClientIp.mockReturnValue('1.2.3.4')
  })

  it('creates a session and returns token with expiry', async () => {
    const headers = new Headers({ 'user-agent': 'test-agent' })
    const result = await createSession({ userId: 'u1', headers })

    expect(result.token).toBe('raw-token')
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(mockSessionService.create).toHaveBeenCalledWith({
      userId: 'u1',
      tokenHash: 'hashed-token',
      expiresAt: expect.any(Date),
      ip: '1.2.3.4',
      userAgent: 'test-agent',
    })
  })

  it('passes null user-agent when header missing', async () => {
    const headers = new Headers()
    await createSession({ userId: 'u1', headers })
    expect(mockSessionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: null }),
    )
  })
})

describe('revokeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHashSessionToken.mockReturnValue('hashed-token')
  })

  it('revokes by token hash', async () => {
    await revokeSession('raw-token')
    expect(mockHashSessionToken).toHaveBeenCalledWith('raw-token')
    expect(mockSessionService.revokeByTokenHash).toHaveBeenCalledWith('hashed-token')
  })
})

describe('getSessionFromToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHashSessionToken.mockReturnValue('hashed-token')
    mockSessionService.touchLastSeen.mockResolvedValue(undefined)
  })

  it('returns user and sessionId for valid session', async () => {
    mockSessionService.findByTokenHash.mockResolvedValue({
      id: 's1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'ADMIN' },
    })

    const result = await getSessionFromToken('token')
    expect(result).toEqual({
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'ADMIN' },
      sessionId: 's1',
    })
    expect(mockSessionService.touchLastSeen).toHaveBeenCalledWith('s1')
  })

  it('returns null when session not found', async () => {
    mockSessionService.findByTokenHash.mockResolvedValue(null)
    expect(await getSessionFromToken('token')).toBeNull()
  })

  it('returns null when session is revoked', async () => {
    mockSessionService.findByTokenHash.mockResolvedValue({
      id: 's1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    })
    expect(await getSessionFromToken('token')).toBeNull()
  })

  it('returns null when session is expired', async () => {
    mockSessionService.findByTokenHash.mockResolvedValue({
      id: 's1',
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    })
    expect(await getSessionFromToken('token')).toBeNull()
  })

  it('still returns session when touchLastSeen fails', async () => {
    mockSessionService.findByTokenHash.mockResolvedValue({
      id: 's1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    })
    mockSessionService.touchLastSeen.mockRejectedValue(new Error('db down'))

    const result = await getSessionFromToken('token')
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('s1')
  })
})
