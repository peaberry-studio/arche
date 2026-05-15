import { createHmac } from 'node:crypto'

import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findByIdWithUser: vi.fn(),
  getCookieDomain: vi.fn(),
  getSession: vi.fn(),
  getSessionPepper: vi.fn(),
  shouldUseSecureCookies: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  createSession: mocks.createSession,
  getCookieDomain: mocks.getCookieDomain,
  SESSION_COOKIE_NAME: 'arche_session',
  shouldUseSecureCookies: mocks.shouldUseSecureCookies,
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/security', () => ({
  getSessionPepper: mocks.getSessionPepper,
}))

vi.mock('@/lib/services', () => ({
  sessionService: {
    findByIdWithUser: mocks.findByIdWithUser,
  },
}))

import {
  clearKbGithubRemoteSetupCookie,
  createKbGithubRemoteSetupState,
  getKbGithubRemoteSetupSession,
  KB_GITHUB_REMOTE_SETUP_COOKIE_NAME,
  setKbGithubRemoteSetupCookie,
  setRestoredSessionCookie,
} from '@/lib/kb-github-remote/setup-state'

const adminUser = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
const user = { email: 'user@example.com', id: 'user-1', role: 'USER', slug: 'alice' }

function request(state?: string, cookieState = state): Request {
  const url = state
    ? `http://localhost/api/u/alice/kb-github-remote/callback?state=${encodeURIComponent(state)}`
    : 'http://localhost/api/u/alice/kb-github-remote/callback'
  return new Request(url, {
    headers: cookieState ? { cookie: `${KB_GITHUB_REMOTE_SETUP_COOKIE_NAME}=${cookieState}` } : undefined,
  })
}

function signedState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', 'pepper').update(body).digest('base64url')
  return `${body}.${signature}`
}

describe('kb-github-remote setup state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
    vi.clearAllMocks()
    mocks.createSession.mockResolvedValue({ expiresAt: new Date('2026-05-16T12:00:00.000Z'), token: 'new-token' })
    mocks.findByIdWithUser.mockResolvedValue({
      expiresAt: new Date('2026-05-16T12:00:00.000Z'),
      id: 'session-1',
      revokedAt: null,
      user: adminUser,
      userId: 'admin-1',
    })
    mocks.getCookieDomain.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue(null)
    mocks.getSessionPepper.mockReturnValue('pepper')
    mocks.shouldUseSecureCookies.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates signed setup states and restores the current session when present', async () => {
    mocks.getSession.mockResolvedValue({ sessionId: 'session-current', user })

    const result = await getKbGithubRemoteSetupSession(request(), 'alice')

    expect(result).toEqual({ ok: true, sessionId: 'session-current', user })
    expect(mocks.findByIdWithUser).not.toHaveBeenCalled()
  })

  it('allows admins to use setup routes for another slug', async () => {
    mocks.getSession.mockResolvedValue({ sessionId: 'session-current', user: adminUser })

    const result = await getKbGithubRemoteSetupSession(request(), 'other')

    expect(result).toEqual({ ok: true, sessionId: 'session-current', user: adminUser })
  })

  it('forbids non-admin sessions for another slug', async () => {
    mocks.getSession.mockResolvedValue({ sessionId: 'session-current', user })

    await expect(getKbGithubRemoteSetupSession(request(), 'other')).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it('rejects missing or mismatched setup state cookies', async () => {
    const state = createKbGithubRemoteSetupState({ sessionId: 'session-1', slug: 'alice', userId: 'admin-1' })

    await expect(getKbGithubRemoteSetupSession(request(), 'alice')).resolves.toEqual({ ok: false, error: 'unauthorized' })
    await expect(getKbGithubRemoteSetupSession(request(state, `${state}x`), 'alice')).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    })
  })

  it('rejects tampered, malformed, expired, and wrong-slug setup states', async () => {
    const validPayload = {
      exp: 1778850000,
      nonce: 'nonce',
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'admin-1',
    }
    const invalidJsonBody = Buffer.from('{', 'utf8').toString('base64url')
    const invalidJson = `${invalidJsonBody}.${createHmac('sha256', 'pepper').update(invalidJsonBody).digest('base64url')}`
    const invalidPayload = signedState({ ...validPayload, userId: 123 })
    const expired = signedState({ ...validPayload, exp: 1778846399 })
    const wrongSlug = signedState({ ...validPayload, slug: 'other' })
    const tampered = `${signedState(validPayload)}x`

    await expect(getKbGithubRemoteSetupSession(request(tampered), 'alice')).resolves.toEqual({ ok: false, error: 'unauthorized' })
    await expect(getKbGithubRemoteSetupSession(request(invalidJson), 'alice')).resolves.toEqual({ ok: false, error: 'unauthorized' })
    await expect(getKbGithubRemoteSetupSession(request(invalidPayload), 'alice')).resolves.toEqual({ ok: false, error: 'unauthorized' })
    await expect(getKbGithubRemoteSetupSession(request(expired), 'alice')).resolves.toEqual({ ok: false, error: 'unauthorized' })
    await expect(getKbGithubRemoteSetupSession(request(wrongSlug), 'alice')).resolves.toEqual({ ok: false, error: 'unauthorized' })
  })

  it('restores a valid original session from setup state', async () => {
    const state = createKbGithubRemoteSetupState({ sessionId: 'session-1', slug: 'alice', userId: 'admin-1' })

    const result = await getKbGithubRemoteSetupSession(request(state), 'alice')

    expect(result).toEqual({
      ok: true,
      restoredSessionCookie: { expiresAt: new Date('2026-05-16T12:00:00.000Z'), token: 'new-token' },
      sessionId: 'session-1',
      user: adminUser,
    })
    expect(mocks.findByIdWithUser).toHaveBeenCalledWith('session-1')
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin-1' }))
  })

  it.each([
    ['missing session', null],
    ['revoked session', { expiresAt: new Date('2026-05-16T12:00:00.000Z'), id: 'session-1', revokedAt: new Date(), user: adminUser, userId: 'admin-1' }],
    ['expired session', { expiresAt: new Date('2026-05-15T11:59:59.000Z'), id: 'session-1', revokedAt: null, user: adminUser, userId: 'admin-1' }],
    ['wrong user', { expiresAt: new Date('2026-05-16T12:00:00.000Z'), id: 'session-1', revokedAt: null, user: adminUser, userId: 'other' }],
  ])('rejects a %s', async (_label, originalSession) => {
    mocks.findByIdWithUser.mockResolvedValue(originalSession)
    const state = createKbGithubRemoteSetupState({ sessionId: 'session-1', slug: 'alice', userId: 'admin-1' })

    await expect(getKbGithubRemoteSetupSession(request(state), 'alice')).resolves.toEqual({ ok: false, error: 'unauthorized' })
  })

  it('forbids restored non-admin sessions for another slug', async () => {
    mocks.findByIdWithUser.mockResolvedValue({
      expiresAt: new Date('2026-05-16T12:00:00.000Z'),
      id: 'session-1',
      revokedAt: null,
      user: { ...user, id: 'admin-1', slug: 'bob' },
      userId: 'admin-1',
    })
    const state = createKbGithubRemoteSetupState({ sessionId: 'session-1', slug: 'alice', userId: 'admin-1' })

    await expect(getKbGithubRemoteSetupSession(request(state), 'alice')).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it('sets and clears setup cookies', () => {
    mocks.shouldUseSecureCookies.mockReturnValue(true)
    const response = NextResponse.json({ ok: true })

    setKbGithubRemoteSetupCookie(response, 'state-1', new Headers())
    expect(response.headers.get('set-cookie')).toContain('arche_kb_github_setup=state-1')
    expect(response.headers.get('set-cookie')).toContain('SameSite=none')
    expect(response.headers.get('set-cookie')).toContain('Secure')

    clearKbGithubRemoteSetupCookie(response, new Headers())
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('sets restored session cookies when present', () => {
    const response = NextResponse.json({ ok: true })

    setRestoredSessionCookie(response, undefined, new Headers())
    expect(response.headers.get('set-cookie')).toBeNull()

    setRestoredSessionCookie(
      response,
      { expiresAt: new Date('2026-05-16T12:00:00.000Z'), token: 'session-token' },
      new Headers(),
    )
    expect(response.headers.get('set-cookie')).toContain('arche_session=session-token')
  })
})
