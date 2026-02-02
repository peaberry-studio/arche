import { NextRequest, NextResponse } from 'next/server'
import { auditEvent, getCookieDomain, revokeSession, SESSION_COOKIE_NAME, shouldUseSecureCookies } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (token) {
    await revokeSession(token).catch(() => {})
    await auditEvent({ action: 'auth.logout' })
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
