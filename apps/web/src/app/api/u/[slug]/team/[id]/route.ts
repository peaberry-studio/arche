import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { stopWorkspace } from '@/lib/runtime/workspace-host'
import { instanceService, userService } from '@/lib/services'

type UserRole = 'ADMIN' | 'USER'

type TeamUserResponse = {
  id: string
  email: string
  slug: string
  role: UserRole
  createdAt: string
}

type UpdateTeamUserRequest = {
  role?: unknown
}

function toTeamUserResponse(user: {
  id: string
  email: string
  slug: string
  role: UserRole
  createdAt: Date
}): TeamUserResponse {
  return {
    id: user.id,
    email: user.email,
    slug: user.slug,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
}

export const PATCH = withAuth<{ user: TeamUserResponse } | { error: string }, { slug: string; id: string }>(
  { csrf: true },
  async (request: NextRequest, { user, params: { id } }) => {
    const denied = requireCapability('teamManagement')
    if (denied) return denied

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: UpdateTeamUserRequest
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const role =
      body.role === 'ADMIN'
        ? 'ADMIN'
        : body.role === 'USER'
          ? 'USER'
          : null

    if (!role) {
      return NextResponse.json({ error: 'invalid_role' }, { status: 400 })
    }

    const targetUser = await userService.findTeamMemberById(id)

    if (!targetUser) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    if (targetUser.role === 'ADMIN' && role === 'USER') {
      const adminCount = await userService.countAdmins()
      if (adminCount <= 1) {
        return NextResponse.json({ error: 'last_admin' }, { status: 409 })
      }
    }

    if (targetUser.role === role) {
      return NextResponse.json({ user: toTeamUserResponse(targetUser) })
    }

    const updatedUser = await userService.updateRole(targetUser.id, role)

    await auditEvent({
      actorUserId: user.id,
      action: 'user.role_updated',
      metadata: {
        targetUserId: updatedUser.id,
        targetUserSlug: updatedUser.slug,
        previousRole: targetUser.role,
        nextRole: updatedUser.role,
      },
    })

    return NextResponse.json({ user: toTeamUserResponse(updatedUser) })
  }
)

export const DELETE = withAuth<{ ok: true } | { error: string }, { slug: string; id: string }>(
  { csrf: true },
  async (request: NextRequest, { user, params: { id } }) => {
    void request

    const deleteDenied = requireCapability('teamManagement')
    if (deleteDenied) return deleteDenied

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const targetUser = await userService.findTeamMemberById(id)

    if (!targetUser) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    if (targetUser.role === 'ADMIN') {
      const adminCount = await userService.countAdmins()
      if (adminCount <= 1) {
        return NextResponse.json({ error: 'last_admin' }, { status: 409 })
      }
    }

    await stopWorkspace(targetUser.slug, user.id).catch(() => {})

    await instanceService.deleteBySlug(targetUser.slug)

    const result = await userService.deleteById(targetUser.id)

    if (result.count === 0) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    await auditEvent({
      actorUserId: user.id === targetUser.id ? null : user.id,
      action: 'user.deleted',
      metadata: {
        deletedUserId: targetUser.id,
        deletedUserEmail: targetUser.email,
        deletedUserRole: targetUser.role,
        deletedUserSlug: targetUser.slug,
      },
    })

    return NextResponse.json({ ok: true })
  }
)
