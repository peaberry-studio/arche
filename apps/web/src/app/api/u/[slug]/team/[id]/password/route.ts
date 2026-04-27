import { NextRequest, NextResponse } from 'next/server'

import { hashArgon2 } from '@/lib/argon2'
import { auditEvent } from '@/lib/auth'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { sessionService, userService } from '@/lib/services'

type ResetUserPasswordRequest = {
  password?: unknown
}

export const POST = withAuth<{ ok: true } | { error: string }, { slug: string; id: string }>(
  { csrf: true },
  async (request: NextRequest, { user, params: { id }, sessionId }) => {
    const denied = requireCapability('teamManagement')
    if (denied) return denied

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: ResetUserPasswordRequest
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const password = typeof body.password === 'string' ? body.password : ''
    if (!password) {
      return NextResponse.json({ error: 'invalid_password' }, { status: 400 })
    }

    const targetUser = await userService.findTeamMemberById(id)
    if (!targetUser) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const passwordHash = await hashArgon2(password)
    await userService.updatePasswordHash(targetUser.id, passwordHash)

    if (targetUser.id === user.id) {
      await sessionService.revokeByUserIdExceptSession(targetUser.id, sessionId)
    } else {
      await sessionService.revokeByUserId(targetUser.id)
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'user.password_reset',
      metadata: {
        targetUserId: targetUser.id,
        targetUserEmail: targetUser.email,
        targetUserSlug: targetUser.slug,
      },
    })

    return NextResponse.json({ ok: true })
  }
)
