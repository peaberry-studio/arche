import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { withAuth } from '@/lib/runtime/with-auth'
import { patService } from '@/lib/services'

export const DELETE = withAuth<{ ok: true } | { error: string }, { slug: string; id: string }>(
  { csrf: true },
  async (_request, { user, params, slug }) => {
    const result = user.role === 'ADMIN'
      ? await patService.revokeById(params.id)
      : await patService.revokeByIdAndUserId(params.id, user.id)

    if (result.count === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'mcp.token_revoked',
      metadata: { slug, tokenId: params.id },
    })

    return NextResponse.json({ ok: true })
  }
)
