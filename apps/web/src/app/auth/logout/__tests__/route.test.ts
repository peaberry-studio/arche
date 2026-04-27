import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  getCookieDomain: vi.fn(() => undefined),
  getRuntimeCapabilities: vi.fn(),
  getSessionFromToken: vi.fn(),
  revokeSession: vi.fn(),
  shouldUseSecureCookies: vi.fn(() => false),
  validateSameOrigin: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
  getCookieDomain: mocks.getCookieDomain,
  getSessionFromToken: mocks.getSessionFromToken,
  revokeSession: mocks.revokeSession,
  SESSION_COOKIE_NAME: 'arche_session',
  shouldUseSecureCookies: mocks.shouldUseSecureCookies,
}))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))

import { POST } from '../route'

function makeRequest(cookie?: string) {
  return new NextRequest('http://localhost/auth/logout', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })
}

describe('POST /auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: true })
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.getSessionFromToken.mockResolvedValue({
      user: { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })
    mocks.revokeSession.mockResolvedValue(undefined)
  })

  it('revokes the session, clears the cookie, and audits logout', async () => {
    const res = await POST(makeRequest('arche_session=raw-token'))
    const body = await res.json()
    const cookie = res.cookies.get('arche_session')

    expect(body).toEqual({ ok: true })
    expect(mocks.getSessionFromToken).toHaveBeenCalledWith('raw-token')
    expect(mocks.revokeSession).toHaveBeenCalledWith('raw-token')
    expect(mocks.auditEvent).toHaveBeenCalledWith({ actorUserId: 'u1', action: 'auth.logout' })
    expect(cookie?.value).toBe('')
    expect(cookie?.expires).toEqual(new Date(0))
  })

  it('returns ok and clears cookie when no session cookie exists', async () => {
    const res = await POST(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true })
    expect(mocks.revokeSession).not.toHaveBeenCalled()
    expect(mocks.auditEvent).not.toHaveBeenCalled()
    expect(res.cookies.get('arche_session')?.value).toBe('')
  })

  it('rejects cross-origin requests when csrf protection is enabled', async () => {
    mocks.validateSameOrigin.mockReturnValue({ ok: false })

    const res = await POST(makeRequest('arche_session=raw-token'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
    expect(mocks.revokeSession).not.toHaveBeenCalled()
  })
})
