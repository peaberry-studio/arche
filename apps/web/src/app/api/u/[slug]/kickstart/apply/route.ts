import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { applyKickstart } from '@/kickstart/apply'

type KickstartApplyResponse =
  | { ok: true }
  | { error: string; message?: string }

export function toStatusCode(error: string): number {
  switch (error) {
    case 'invalid_payload':
      return 400
    case 'conflict':
    case 'already_configured':
      return 409
    case 'kb_unavailable':
      return 503
    default:
      return 500
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<KickstartApplyResponse>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug } = await params
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
    }
    throw error
  }

  const result = await applyKickstart(payload, session.user.id)
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message: result.message,
      },
      { status: toStatusCode(result.error) }
    )
  }

  return NextResponse.json({ ok: true })
}
