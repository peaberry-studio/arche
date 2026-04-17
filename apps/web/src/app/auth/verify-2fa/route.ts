import { NextResponse } from 'next/server'

import { verifyArgon2 } from '@/lib/argon2'
import { auditEvent, createSession, getCookieDomain, SESSION_COOKIE_NAME, shouldUseSecureCookies } from '@/lib/auth'
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit'
import { hashSessionToken } from '@/lib/security'
import { userService } from '@/lib/services'
import { decryptSecret, verifyTotp } from '@/lib/totp'
import { pending2FAMap } from '../login/route'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const challengeToken = typeof body?.challengeToken === 'string' ? body.challengeToken : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const isRecoveryCode = body?.isRecoveryCode === true

  if (!challengeToken || !code) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }

  const hashedToken = hashSessionToken(challengeToken)
  const challenge = pending2FAMap.get(hashedToken)

  if (!challenge || challenge.expiresAt < Date.now()) {
    pending2FAMap.delete(hashedToken)
    return NextResponse.json({ ok: false, error: 'challenge_expired' }, { status: 401 })
  }

  const limit = checkRateLimit(`2fa:${challenge.userId}`, 5, 15 * 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000) },
      { status: 429 }
    )
  }

  const user = await userService.find2faById(challenge.userId)

  if (!user || !user.totpSecret) {
    pending2FAMap.delete(hashedToken)
    return NextResponse.json({ ok: false, error: 'invalid_state' }, { status: 400 })
  }

  let verified = false
  let totpWindowStart: Date | undefined

  if (isRecoveryCode) {
    for (const recovery of user.twoFactorRecovery) {
      if (await verifyArgon2(recovery.codeHash, code.toUpperCase())) {
        await userService.markRecoveryCodeUsed(recovery.id)
        verified = true
        await auditEvent({
          actorUserId: user.id,
          action: 'auth.2fa.recovery_code_used',
          metadata: { remainingCodes: user.twoFactorRecovery.length - 1 },
        })
        break
      }
    }
  } else {
    const secret = decryptSecret(user.totpSecret)
    const result = verifyTotp(secret, code, user.totpLastUsedAt)
    verified = result.valid
    totpWindowStart = result.windowStart
  }

  if (!verified) {
    await auditEvent({ actorUserId: user.id, action: 'auth.2fa.verification_failed', metadata: { isRecoveryCode } })
    return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 401 })
  }

  // Update last used timestamp for replay protection (only for TOTP, not recovery codes)
  if (totpWindowStart) {
    await userService.updateTotpLastUsedAt(user.id, totpWindowStart)
  }

  pending2FAMap.delete(hashedToken)
  resetRateLimit(`2fa:${user.id}`)

  const { token, expiresAt } = await createSession({ userId: user.id, headers: request.headers })
  await auditEvent({ actorUserId: user.id, action: 'auth.login.succeeded', metadata: { via: '2fa' } })

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, slug: user.slug, role: user.role },
  })
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request.headers),
    path: '/',
    domain: getCookieDomain(),
    expires: expiresAt,
  })

  return res
}
