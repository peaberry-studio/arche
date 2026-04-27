import { NextRequest, NextResponse } from 'next/server'

import { hashArgon2 } from '@/lib/argon2'
import { auditEvent } from '@/lib/auth'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { userService } from '@/lib/services'
import { validatePassword } from '@/lib/validation/password'

type ResetUserPasswordRequest = {
  password?: unknown
}

export const POST = withAuth<{ ok: true } | { error: string; message?: string }, { slug: string; id: string }>(
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
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: 'invalid_password', message: passwordValidation.message },
        { status: 400 }
      )
    }

    const targetUser = await userService.findTeamMemberById(id)
    if (!targetUser) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const passwordHash = await hashArgon2(password)
    await userService.updatePasswordHashAndRevokeSessions(
      targetUser.id,
      passwordHash,
      targetUser.id === user.id ? sessionId : undefined
    )

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
