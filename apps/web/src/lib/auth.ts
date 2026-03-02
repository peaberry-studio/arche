import argon2 from 'argon2'
import { prisma } from '@/lib/prisma'
import { getClientIp } from '@/lib/http'
import { hashSessionToken, newSessionToken } from '@/lib/security'

export const SESSION_COOKIE_NAME = 'arche_session'

export function isDesktopNoAuthEnabled(): boolean {
  const raw = process.env.ARCHE_DESKTOP_NO_AUTH?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

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
  try {
    await prisma.auditEvent.create({
      data: {
        actorUserId: args.actorUserId ?? null,
        action: args.action,
        metadata: args.metadata ?? undefined
      }
    })
  } catch {
    // best-effort
  }
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

  await prisma.session.create({
    data: {
      userId: params.userId,
      tokenHash,
      expiresAt,
      ip,
      userAgent
    }
  })

  return { token, expiresAt }
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token)
  await prisma.session.updateMany({
    where: {
      tokenHash,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  })
}

type AuthenticatedSession = {
  user: { id: string; email: string; slug: string; role: string }
  sessionId: string
}

async function createDesktopFallbackUser(): Promise<AuthenticatedSession | null> {
  const configuredSlug = process.env.ARCHE_DESKTOP_DEFAULT_USER_SLUG?.trim().toLowerCase()
  const slug = configuredSlug || 'admin'
  const email = process.env.ARCHE_DESKTOP_DEFAULT_USER_EMAIL?.trim().toLowerCase() || `${slug}@localhost`

  try {
    const passwordHash = await argon2.hash(newSessionToken())
    const user = await prisma.user.upsert({
      where: { slug },
      update: {},
      create: {
        email,
        passwordHash,
        role: 'ADMIN',
        slug,
      },
      select: { id: true, email: true, slug: true, role: true },
    })

    return { user, sessionId: `desktop-no-auth:${user.id}` }
  } catch {
    return null
  }
}

async function getDesktopBypassSession(): Promise<AuthenticatedSession | null> {
  const preferredSlug = process.env.ARCHE_DESKTOP_DEFAULT_USER_SLUG?.trim().toLowerCase()
  if (preferredSlug) {
    const preferred = await prisma.user.findUnique({
      where: { slug: preferredSlug },
      select: { id: true, email: true, slug: true, role: true },
    })
    if (preferred) {
      return { user: preferred, sessionId: `desktop-no-auth:${preferred.id}` }
    }
  }

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, slug: true, role: true },
  })
  if (admin) {
    return { user: admin, sessionId: `desktop-no-auth:${admin.id}` }
  }

  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, slug: true, role: true },
  })
  if (!firstUser) {
    return createDesktopFallbackUser()
  }

  return { user: firstUser, sessionId: `desktop-no-auth:${firstUser.id}` }
}

export async function getSessionFromToken(token: string): Promise<{
  user: { id: string; email: string; slug: string; role: string }
  sessionId: string
} | null> {
  if (isDesktopNoAuthEnabled()) {
    const bypassSession = await getDesktopBypassSession()
    if (bypassSession) return bypassSession
  }

  if (!token) return null

  const tokenHash = hashSessionToken(token)
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true }
  })

  if (!session) return null
  if (session.revokedAt) return null
  if (session.expiresAt.getTime() <= Date.now()) return null

  await prisma.session
    .update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date()
      }
    })
    .catch(() => {})

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
  if (!token) {
    if (isDesktopNoAuthEnabled()) {
      return getDesktopBypassSession()
    }
    return null
  }
  return getSessionFromToken(token)
}
