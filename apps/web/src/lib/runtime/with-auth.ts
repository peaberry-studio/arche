import { NextRequest, NextResponse } from 'next/server'

import { validateSameOrigin } from '@/lib/csrf'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import {
  DESKTOP_TOKEN_HEADER,
  validateDesktopToken,
} from '@/lib/runtime/desktop/token'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import type { RuntimeUser } from '@/lib/runtime/types'

export type AuthContext<P extends Record<string, string> = Record<string, string>> = {
  user: RuntimeUser
  sessionId: string
  slug: string
  params: P
}

export type GlobalAuthContext<P extends Record<string, string> = Record<string, string>> = {
  user: RuntimeUser
  sessionId: string
  params: P
}

type AuthOptions = {
  csrf?: boolean
}

type AuthenticatedSession = {
  user: RuntimeUser
  sessionId: string
}

export function withAuth<T, P extends { slug: string } = { slug: string }>(
  options: AuthOptions,
  handler: (request: NextRequest, context: AuthContext<P>) => Promise<Response | NextResponse<T>>
) {
  return async (
    request: NextRequest,
    { params }: { params: Promise<P> }
  ): Promise<Response | NextResponse<T | { error: string }>> => {
    const resolvedParams = await params
    const session = await authenticateRequest(request, options)
    if (!session.ok) return session.response

    if (session.user.slug !== resolvedParams.slug && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    return handler(request, {
      user: session.user,
      sessionId: session.sessionId,
      slug: resolvedParams.slug,
      params: resolvedParams,
    })
  }
}

export function withGlobalAuth<T, P extends Record<string, string> = Record<string, string>>(
  options: AuthOptions,
  handler: (request: NextRequest, context: GlobalAuthContext<P>) => Promise<Response | NextResponse<T>>
) {
  return async (
    request: NextRequest,
    context?: { params?: Promise<P> }
  ): Promise<Response | NextResponse<T | { error: string }>> => {
    const session = await authenticateRequest(request, options)
    if (!session.ok) return session.response

    return handler(request, {
      user: session.user,
      sessionId: session.sessionId,
      params: context?.params ? await context.params : {} as P,
    })
  }
}

async function authenticateRequest(
  request: NextRequest,
  options: AuthOptions
): Promise<
  | ({ ok: true } & AuthenticatedSession)
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const caps = getRuntimeCapabilities()

  if (isDesktop()) {
    const token = request.headers.get(DESKTOP_TOKEN_HEADER)
    if (!validateDesktopToken(token)) {
      return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
    }
  }

  if (options.csrf && caps.csrf) {
    const originValidation = validateSameOrigin(request)
    if (!originValidation.ok) {
      return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
    }
  }

  const session = await getSession()
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }

  return { ok: true, user: session.user, sessionId: session.sessionId }
}
