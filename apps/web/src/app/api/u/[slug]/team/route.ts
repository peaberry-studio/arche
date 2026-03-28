import { NextRequest, NextResponse } from 'next/server'

import argon2 from 'argon2'

import { auditEvent } from '@/lib/auth'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { userService } from '@/lib/services'
import { validateSlug } from '@/lib/validation/slug'

type UserRole = 'ADMIN' | 'USER'

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

export const GET = withAuth<TeamListResponse | { error: string }>(
  { csrf: false },
  async (request: NextRequest, { user }) => {
    void request

    const denied = requireCapability('teamManagement')
    if (denied) {
      const currentUser = await userService.findTeamMemberById(user.id)

      return NextResponse.json({
        users: currentUser ? [toTeamUserListItem(currentUser)] : [],
      })
    }

    const users = await userService.findTeamMembers()

    return NextResponse.json({
      users: users.map(toTeamUserListItem),
    })
  }
)

export const POST = withAuth<{ user: TeamUserListItem } | { error: string; message?: string }>(
  { csrf: true },
  async (request: NextRequest, { user }) => {
    const denied = requireCapability('teamManagement')
    if (denied) return denied

    if (user.role !== 'ADMIN') {
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
    const role = body.role === 'ADMIN' ? 'ADMIN' : body.role === 'USER' ? 'USER' : null

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

    const existingUser = await userService.findExistingByEmailOrSlug(email, userSlug)

    if (existingUser) {
      const error = existingUser.email === email ? 'email_in_use' : 'slug_in_use'
      return NextResponse.json({ error }, { status: 409 })
    }

    const passwordHash = await argon2.hash(password)

    try {
      const createdUser = await userService.create({
        email,
        slug: userSlug,
        role,
        passwordHash,
      })

      await auditEvent({
        actorUserId: user.id,
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
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
        return NextResponse.json({ error: 'user_exists' }, { status: 409 })
      }

      return NextResponse.json({ error: 'create_failed' }, { status: 500 })
    }
  }
)
