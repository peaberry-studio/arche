import crypto from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  createSession,
  getCookieDomain,
  SESSION_COOKIE_NAME,
  shouldUseSecureCookies,
} from '@/lib/auth'
import { getSession } from '@/lib/runtime/session'
import type { RuntimeUser } from '@/lib/runtime/types'
import { getSessionPepper } from '@/lib/security'
import { sessionService } from '@/lib/services'

export const KB_GITHUB_REMOTE_SETUP_COOKIE_NAME = 'arche_kb_github_setup'

const SETUP_STATE_TTL_SECONDS = 60 * 60

type KbGithubRemoteSetupStatePayload = {
  exp: number
  nonce: string
  sessionId: string
  slug: string
  userId: string
}

type RestoredSessionCookie = {
  expiresAt: Date
  token: string
}

export type KbGithubRemoteSetupSessionResult =
  | {
      ok: true
      restoredSessionCookie?: RestoredSessionCookie
      sessionId: string
      user: RuntimeUser
    }
  | { ok: false; error: 'forbidden' | 'unauthorized' }

export function createKbGithubRemoteSetupState(args: {
  sessionId: string
  slug: string
  userId: string
}): string {
  const payload: KbGithubRemoteSetupStatePayload = {
    exp: Math.floor(Date.now() / 1000) + SETUP_STATE_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString('base64url'),
    sessionId: args.sessionId,
    slug: args.slug,
    userId: args.userId,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

export async function getKbGithubRemoteSetupSession(
  request: Request,
  slug: string,
): Promise<KbGithubRemoteSetupSessionResult> {
  const session = await getSession()
  if (session) {
    if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
      return { ok: false, error: 'forbidden' }
    }

    return {
      ok: true,
      sessionId: session.sessionId,
      user: session.user,
    }
  }

  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const cookieState = getRequestCookie(request.headers, KB_GITHUB_REMOTE_SETUP_COOKIE_NAME)
  if (!state || !cookieState || state !== cookieState) {
    return { ok: false, error: 'unauthorized' }
  }

  const verified = verifyKbGithubRemoteSetupState(state)
  if (!verified.ok || verified.payload.slug !== slug) {
    return { ok: false, error: 'unauthorized' }
  }

  const originalSession = await sessionService.findByIdWithUser(verified.payload.sessionId)
  if (
    !originalSession
    || originalSession.revokedAt
    || originalSession.expiresAt.getTime() <= Date.now()
    || originalSession.userId !== verified.payload.userId
  ) {
    return { ok: false, error: 'unauthorized' }
  }

  if (originalSession.user.slug !== slug && originalSession.user.role !== 'ADMIN') {
    return { ok: false, error: 'forbidden' }
  }

  const restoredSessionCookie = await createSession({
    headers: request.headers,
    userId: originalSession.user.id,
  })

  return {
    ok: true,
    restoredSessionCookie,
    sessionId: originalSession.id,
    user: originalSession.user,
  }
}

export function setKbGithubRemoteSetupCookie(response: NextResponse, state: string, headers: Headers): void {
  const secure = shouldUseSecureCookies(headers)
  response.cookies.set({
    name: KB_GITHUB_REMOTE_SETUP_COOKIE_NAME,
    value: state,
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
    domain: getCookieDomain(),
    maxAge: SETUP_STATE_TTL_SECONDS,
  })
}

export function clearKbGithubRemoteSetupCookie(response: NextResponse, headers: Headers): void {
  const secure = shouldUseSecureCookies(headers)
  response.cookies.set({
    name: KB_GITHUB_REMOTE_SETUP_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
    domain: getCookieDomain(),
    maxAge: 0,
  })
}

export function setRestoredSessionCookie(
  response: NextResponse,
  restoredSessionCookie: RestoredSessionCookie | undefined,
  headers: Headers,
): void {
  if (!restoredSessionCookie) return

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: restoredSessionCookie.token,
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(headers),
    path: '/',
    domain: getCookieDomain(),
    expires: restoredSessionCookie.expiresAt,
  })
}

function verifyKbGithubRemoteSetupState(
  state: string,
): { ok: true; payload: KbGithubRemoteSetupStatePayload } | { ok: false } {
  const [body, signature] = state.split('.')
  if (!body || !signature || !timingSafeEqual(signature, sign(body))) {
    return { ok: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false }
  }

  if (!isSetupStatePayload(parsed) || parsed.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false }
  }

  return { ok: true, payload: parsed }
}

function sign(body: string): string {
  return crypto.createHmac('sha256', getSessionPepper()).update(body).digest('base64url')
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function isSetupStatePayload(value: unknown): value is KbGithubRemoteSetupStatePayload {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.exp === 'number'
    && typeof record.nonce === 'string'
    && typeof record.sessionId === 'string'
    && typeof record.slug === 'string'
    && typeof record.userId === 'string'
}

function getRequestCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie')
  if (!raw) return null

  for (const part of raw.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=')
    if (rawName === name) {
      return rawValueParts.join('=') || null
    }
  }

  return null
}
