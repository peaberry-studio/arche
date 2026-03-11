import { NextResponse } from 'next/server'

import { applyKickstart } from '@/kickstart/apply'
import { withAuth } from '@/lib/runtime/with-auth'

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

export const POST = withAuth<KickstartApplyResponse>(
  { csrf: true },
  async (request, { user }) => {
    if (user.role !== 'ADMIN') {
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

    const result = await applyKickstart(payload, user.id)
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
)
