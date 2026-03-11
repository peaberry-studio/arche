import { NextResponse } from 'next/server'

import { auditEvent, createSession, getCookieDomain, SESSION_COOKIE_NAME, shouldUseSecureCookies, verifyPassword } from '@/lib/auth'
import { hashSessionToken, newSessionToken } from '@/lib/security'
import { userService } from '@/lib/services'

// Pending 2FA challenges: hashedToken -> { userId, expiresAt }
// NOTE: In-memory storage — only works in single-process deployments (Docker/Podman).
// For serverless or multi-instance deployments, migrate to Redis or database storage.
export const pending2FAMap = new Map<string, { userId: string; expiresAt: number }>()

// Clean up expired challenges every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of pending2FAMap) {
    if (entry.expiresAt <= now) pending2FAMap.delete(key)
  }
}, 5 * 60 * 1000).unref()

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }

  const user = await userService.findLoginByEmail(email)
  if (!user) {
    await auditEvent({ action: 'auth.login.failed', metadata: { email } })
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 })
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    await auditEvent({ actorUserId: user.id, action: 'auth.login.failed' })
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 })
  }

  if (user.totpEnabled) {
    const challengeToken = newSessionToken()
    const hashedToken = hashSessionToken(challengeToken)
    pending2FAMap.set(hashedToken, {
      userId: user.id,
      expiresAt: Date.now() + 5 * 60 * 1000,
    })
    await auditEvent({ actorUserId: user.id, action: 'auth.2fa.challenge_issued' })
    return NextResponse.json({ ok: true, requires2FA: true, challengeToken })
  }

  const { token, expiresAt } = await createSession({ userId: user.id, headers: request.headers })
  await auditEvent({ actorUserId: user.id, action: 'auth.login.succeeded' })

  const res = NextResponse.json({
    ok: true,
    requires2FA: false,
    user: { id: user.id, email: user.email, slug: user.slug, role: user.role }
  })
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request.headers),
    path: '/',
    domain: getCookieDomain(),
    expires: expiresAt
  })

  return res
}
