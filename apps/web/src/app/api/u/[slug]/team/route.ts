import { NextRequest, NextResponse } from 'next/server'

import argon2 from 'argon2'
import { Prisma, UserRole } from '@prisma/client'

import { auditEvent, getAuthenticatedUser } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { prisma } from '@/lib/prisma'
import { validateSlug } from '@/lib/validation/slug'

type TeamUserListItem = {
  id: string
  email: string
  slug: string
  role: UserRole
  createdAt: string
}

type TeamListResponse = {
  users: TeamUserListItem[]
}

type CreateTeamUserRequest = {
  email?: unknown
  slug?: unknown
  password?: unknown
  role?: unknown
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function toTeamUserListItem(user: {
  id: string
  email: string
  slug: string
  role: UserRole
  createdAt: Date
}): TeamUserListItem {
  return {
    id: user.id,
    email: user.email,
    slug: user.slug,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<TeamListResponse | { error: string }>> {
  void request

  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      slug: true,
      role: true,
      createdAt: true,
    },
    orderBy: [
      { role: 'asc' },
      { createdAt: 'desc' },
    ],
  })

  return NextResponse.json({
    users: users.map(toTeamUserListItem),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<{ user: TeamUserListItem } | { error: string; message?: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug: routeSlug } = await params
  if (session.user.slug !== routeSlug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: CreateTeamUserRequest
  try {
    body = await request.json()
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    throw err
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const userSlug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const role = body.role === UserRole.ADMIN ? UserRole.ADMIN : body.role === UserRole.USER ? UserRole.USER : null

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  const slugValidation = validateSlug(userSlug)
  if (!slugValidation.valid) {
    return NextResponse.json({ error: 'invalid_slug', message: slugValidation.error }, { status: 400 })
  }

  if (!password) {
    return NextResponse.json({ error: 'invalid_password' }, { status: 400 })
  }

  if (!role) {
    return NextResponse.json({ error: 'invalid_role' }, { status: 400 })
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { slug: userSlug }],
    },
    select: {
      email: true,
      slug: true,
    },
  })

  if (existingUser) {
    const error = existingUser.email === email ? 'email_in_use' : 'slug_in_use'
    return NextResponse.json({ error }, { status: 409 })
  }

  const passwordHash = await argon2.hash(password)

  try {
    const createdUser = await prisma.user.create({
      data: {
        email,
        slug: userSlug,
        role,
        passwordHash,
      },
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
      action: 'user.created',
      metadata: { createdUserId: createdUser.id, createdUserSlug: createdUser.slug, role: createdUser.role },
    })

    return NextResponse.json(
      {
        user: toTeamUserListItem(createdUser),
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'user_exists' }, { status: 409 })
    }

    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }
}
