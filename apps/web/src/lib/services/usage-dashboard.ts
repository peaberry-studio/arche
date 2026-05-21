import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type UsageSessionFilters = {
  from?: Date
  to?: Date
  userId?: string
}

export type UsageAuditFilters = UsageSessionFilters & {
  providerId?: string
  modelId?: string
}

function buildSessionWhere(filters: UsageSessionFilters): Prisma.SessionWhereInput {
  return {
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
  }
}

function metadataMatchesFilters(metadata: unknown, filters: UsageAuditFilters): boolean {
  if (!filters.providerId && !filters.modelId) return true
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

  const record = metadata as Record<string, unknown>
  if (filters.providerId && record.providerId !== filters.providerId) return false
  if (filters.modelId && record.modelId !== filters.modelId) return false
  return true
}

export async function listUsageSessions(filters: UsageSessionFilters): Promise<Array<{
  id: string
  user: { id: string; email: string; slug: string } | null
  userId: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  durationMs: number
  ip: string | null
  userAgent: string | null
}>> {
  const sessions = await prisma.session.findMany({
    where: buildSessionWhere(filters),
    include: {
      user: { select: { id: true, email: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return sessions.map((session) => {
    const endedAt = session.revokedAt ?? session.lastSeenAt ?? session.createdAt
    return {
      id: session.id,
      user: session.user,
      userId: session.userId,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
      revokedAt: session.revokedAt?.toISOString() ?? null,
      durationMs: Math.max(0, endedAt.getTime() - session.createdAt.getTime()),
      ip: session.ip,
      userAgent: session.userAgent,
    }
  })
}

export async function listUsageAuditEvents(filters: UsageAuditFilters): Promise<Array<{
  id: string
  action: string
  actorUserId: string | null
  actorUser: { id: string; email: string; slug: string } | null
  metadata: unknown
  createdAt: string
}>> {
  const events = await prisma.auditEvent.findMany({
    where: {
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.userId ? { actorUserId: filters.userId } : {}),
    },
    include: {
      actorUser: { select: { id: true, email: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return events
    .filter((event) => metadataMatchesFilters(event.metadata, filters))
    .map((event) => ({
      id: event.id,
      action: event.action,
      actorUserId: event.actorUserId,
      actorUser: event.actorUser,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    }))
}
