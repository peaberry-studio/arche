import { NextRequest, NextResponse } from 'next/server'

import { UserRole } from '@prisma/client'

import { auditEvent, getAuthenticatedUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stopInstance } from '@/lib/spawner/core'

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<{ user: TeamUserResponse } | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug, id } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (session.user.role !== 'ADMIN') {
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
    body.role === UserRole.ADMIN
      ? UserRole.ADMIN
      : body.role === UserRole.USER
        ? UserRole.USER
        : null

  if (!role) {
    return NextResponse.json({ error: 'invalid_role' }, { status: 400 })
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      slug: true,
      role: true,
      createdAt: true,
    },
  })

  if (!targetUser) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  if (targetUser.role === UserRole.ADMIN && role === UserRole.USER) {
    const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } })
    if (adminCount <= 1) {
      return NextResponse.json({ error: 'last_admin' }, { status: 409 })
    }
  }

  if (targetUser.role === role) {
    return NextResponse.json({ user: toTeamUserResponse(targetUser) })
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUser.id },
    data: { role },
    select: {
      id: true,
      email: true,
      slug: true,
      role: true,
      createdAt: true,
    },
  })

  await auditEvent({
    actorUserId: session.user.id,
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<{ ok: true } | { error: string }>> {
  void request

  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug, id } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { id: true, slug: true, role: true, email: true },
  })

  if (!targetUser) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  if (targetUser.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } })
    if (adminCount <= 1) {
      return NextResponse.json({ error: 'last_admin' }, { status: 409 })
    }
  }

  await stopInstance(targetUser.slug, session.user.id).catch(() => {})

  await prisma.instance.deleteMany({
    where: { slug: targetUser.slug },
  })

  const result = await prisma.user.deleteMany({
    where: { id: targetUser.id },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  await auditEvent({
    actorUserId: session.user.id === targetUser.id ? null : session.user.id,
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
