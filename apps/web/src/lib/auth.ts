import argon2 from 'argon2'

import { getClientIp } from '@/lib/http'
import { hashSessionToken, newSessionToken } from '@/lib/security'
import { auditService, sessionService } from '@/lib/services'

export const SESSION_COOKIE_NAME = 'arche_session'

export function shouldUseSecureCookies(headers?: Headers): boolean {
  const raw = process.env.ARCHE_COOKIE_SECURE?.trim().toLowerCase()
  if (raw === 'true') return true
  if (raw === 'false') return false

  const proto = headers?.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (proto === 'https') return true
  if (proto === 'http') return false

  return process.env.NODE_ENV === 'production'
}

export function getCookieDomain(): string | undefined {
  // In development, don't set domain to allow localhost to work
  if (process.env.NODE_ENV !== 'production') return undefined

  const explicit = process.env.ARCHE_COOKIE_DOMAIN?.trim()
  if (explicit) return explicit

  const base = process.env.ARCHE_DOMAIN?.trim()
  if (!base) return undefined
  return `.${base.replace(/^\./, '')}`
}

export function getSessionTtlDays(): number {
  const raw = process.env.ARCHE_SESSION_TTL_DAYS
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return 7
  return Math.floor(parsed)
}

export async function auditEvent(args: {
  actorUserId?: string | null
  action: string
  metadata?: unknown
}): Promise<void> {
  return auditService.createEvent(args)
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return argon2.verify(passwordHash, password)
}

export async function createSession(params: {
  userId: string
  headers: Headers
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken()
  const tokenHash = hashSessionToken(token)
  const ttlDays = getSessionTtlDays()
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  const ip = getClientIp(params.headers)
  const userAgent = params.headers.get('user-agent') || null

  await sessionService.create({
    userId: params.userId,
    tokenHash,
    expiresAt,
    ip,
    userAgent,
  })

  return { token, expiresAt }
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token)
  await sessionService.revokeByTokenHash(tokenHash)
}

export async function getSessionFromToken(token: string): Promise<{
  user: { id: string; email: string; slug: string; role: string }
  sessionId: string
} | null> {
  const tokenHash = hashSessionToken(token)
  const session = await sessionService.findByTokenHash(tokenHash)

  if (!session) return null
  if (session.revokedAt) return null
  if (session.expiresAt.getTime() <= Date.now()) return null

  await sessionService.touchLastSeen(session.id).catch(() => {})

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      slug: session.user.slug,
      role: session.user.role
    },
    sessionId: session.id
  }
}

/**
 * Get authenticated user from request cookies.
 * Use this in API routes to verify authentication.
 */
export async function getAuthenticatedUser() {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return getSessionFromToken(token)
}
