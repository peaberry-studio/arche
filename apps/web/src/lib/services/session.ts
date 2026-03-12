import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Query return shapes
// ---------------------------------------------------------------------------

export type SessionWithUser = {
  id: string
  expiresAt: Date
  revokedAt: Date | null
  userId: string
  user: {
    id: string
    email: string
    slug: string
    role: string
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
  return prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      userId: true,
      user: {
        select: {
          id: true,
          email: true,
          slug: true,
          role: true,
        },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function create(data: {
  userId: string
  tokenHash: string
  expiresAt: Date
  ip: string | null
  userAgent: string | null
}) {
  return prisma.session.create({ data })
}

export function revokeByTokenHash(tokenHash: string) {
  return prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export function touchLastSeen(id: string) {
  return prisma.session.update({
    where: { id },
    data: { lastSeenAt: new Date() },
  })
}
