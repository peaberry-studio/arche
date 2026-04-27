import { NextRequest, NextResponse } from 'next/server'

import { auditEvent, getCookieDomain, getSessionFromToken, revokeSession, SESSION_COOKIE_NAME, shouldUseSecureCookies } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

export async function POST(request: NextRequest) {
  if (getRuntimeCapabilities().csrf) {
    const originValidation = validateSameOrigin(request)
    if (!originValidation.ok) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (token) {
    const session = await getSessionFromToken(token).catch(() => null)
    await revokeSession(token).catch(() => {})
    await auditEvent({ actorUserId: session?.user.id ?? null, action: 'auth.logout' })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request.headers),
    path: '/',
    domain: getCookieDomain(),
    expires: new Date(0)
  })

  return res
}
