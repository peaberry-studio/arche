import { NextResponse } from 'next/server'

import { validateSameOrigin } from '@/lib/csrf'

import { auditEvent, createSession, getCookieDomain, SESSION_COOKIE_NAME, shouldUseSecureCookies, verifyPassword } from '@/lib/auth'
import { isE2eHooksEnabled } from '@/lib/e2e/runtime'
import { getClientIp } from '@/lib/http'
import { checkRateLimit } from '@/lib/rate-limit'
import { hashSessionToken, newSessionToken } from '@/lib/security'
import { userService } from '@/lib/services'

const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$/J+hk5YbuHbvY7gqG0IN7Q$98bhv7R56mmMrs7/n6pZLqCpLZ8x0dpEebX+6d7VBh8'

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
  if (!validateSameOrigin(request).ok) {
    return NextResponse.json({ ok: false, error: 'invalid_origin' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }

  const ip = getClientIp(request.headers) ?? 'unknown'
  // E2E suites run many successful logins from a single IP against one dev
  // server; skip the throttle only in that non-production, opted-in mode.
  if (!isE2eHooksEnabled()) {
    const limits = [
      checkRateLimit('login:global', 300, 60_000),
      checkRateLimit(`login:ip:${ip}`, 30, 60_000),
      checkRateLimit(`login:${ip}:${email}`, 5, 15 * 60 * 1000),
    ]
    const limit = limits.find((entry) => !entry.allowed) ?? limits[2]
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'rate_limited', retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000) },
        { status: 429 }
      )
    }
  }

  const user = await userService.findLoginByEmail(email)
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
  if (!user) {
    await auditEvent({ action: 'auth.login.failed', metadata: { email } })
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 })
  }

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
