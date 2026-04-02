import { prisma } from '@/lib/prisma'

export type PatWithUser = {
  id: string
  userId: string
  tokenHash: string
  salt: string
  expiresAt: Date
  revokedAt: Date | null
  user: {
    id: string
    email: string
    slug: string
    role: string
  }
}

export type PatListEntry = {
  id: string
  name: string
  scopes: string[]
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}

export function findByLookupHash(lookupHash: string): Promise<PatWithUser | null> {
  return prisma.personalAccessToken.findUnique({
    where: { lookupHash },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      salt: true,
      expiresAt: true,
      revokedAt: true,
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

export function findManyByUserId(userId: string): Promise<PatListEntry[]> {
  return prisma.personalAccessToken.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

export function create(data: {
  userId: string
  name: string
  lookupHash: string
  tokenHash: string
  salt: string
  scopes: string[]
  expiresAt: Date
}) {
  return prisma.personalAccessToken.create({ data })
}

export function revokeByIdAndUserId(id: string, userId: string) {
  return prisma.personalAccessToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export function touchLastUsed(id: string) {
  return prisma.personalAccessToken.update({
    where: { id },
    data: { lastUsedAt: new Date() },
  })
}
