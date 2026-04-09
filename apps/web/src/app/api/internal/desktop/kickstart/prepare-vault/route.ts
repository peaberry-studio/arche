import { NextRequest, NextResponse } from 'next/server'

import { applyKickstart } from '@/kickstart/apply'
import { getDesktopSession } from '@/lib/runtime/session-desktop'
import {
  runWithDesktopVaultContext,
} from '@/lib/runtime/desktop/context'
import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { DESKTOP_TOKEN_HEADER, validateDesktopToken } from '@/lib/runtime/desktop/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toStatusCode(error: string): number {
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

export async function POST(request: NextRequest) {
  const token = request.headers.get(DESKTOP_TOKEN_HEADER)
  if (!validateDesktopToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    kickstartPayload?: unknown
    vaultPath?: unknown
  } | null

  const vaultPath = typeof body?.vaultPath === 'string' ? body.vaultPath.trim() : ''
  if (!vaultPath) {
    return NextResponse.json({ error: 'invalid_payload', message: 'vaultPath is required' }, { status: 400 })
  }

  const result = await runWithDesktopVaultContext(vaultPath, async () => {
    try {
      const session = await getDesktopSession()
      return applyKickstart(body?.kickstartPayload, session.user.id)
    } finally {
      const context = getDesktopVaultRuntimeContext()
      await context?.prismaClient?.$disconnect?.().catch(() => undefined)
      if (context) {
        delete context.initPromise
        delete context.prismaClient
        delete context.prismaClientPromise
        delete context.session
      }
    }
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message: result.message,
      },
      { status: toStatusCode(result.error) },
    )
  }

  return NextResponse.json({ ok: true })
}
