import { NextRequest, NextResponse } from 'next/server'

import { validateSameOrigin } from '@/lib/csrf'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getSession } from '@/lib/runtime/session'
import type { RuntimeUser } from '@/lib/runtime/types'

export type AuthContext<P extends Record<string, string> = Record<string, string>> = {
  user: RuntimeUser
  sessionId: string
  slug: string
  params: P
}

type AuthOptions = {
  csrf?: boolean
}

export function withAuth<T, P extends { slug: string } = { slug: string }>(
  options: AuthOptions,
  handler: (request: NextRequest, context: AuthContext<P>) => Promise<NextResponse<T>>
) {
  return async (
    request: NextRequest,
    { params }: { params: Promise<P> }
  ): Promise<NextResponse<T | { error: string }>> => {
    const caps = getRuntimeCapabilities()
    const resolvedParams = await params

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    if (options.csrf && caps.csrf) {
      const originValidation = validateSameOrigin(request)
      if (!originValidation.ok) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    }

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
