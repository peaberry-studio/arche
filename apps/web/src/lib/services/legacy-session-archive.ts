import type { LegacySessionArchive, Prisma } from '@prisma/client'

import { formatTimestamp } from '@/lib/format-timestamp'
import { prisma } from '@/lib/prisma'
import type { WorkspaceMessage, WorkspaceSession } from '@/types/workspace-runtime'

export type ArchivedSession = {
  session: WorkspaceSession & { archived: true }
  messages: WorkspaceMessage[]
}

export type ExportedSessionMetadata = {
  parentId: string | null
  title: string
  createdAt: Date
  updatedAt: Date
}

function toSession(record: Omit<LegacySessionArchive, 'messages' | 'validatedAt'>): ArchivedSession['session'] {
  return {
    id: record.sessionId,
    title: record.title,
    status: 'idle',
    updatedAt: formatTimestamp(record.updatedAt.getTime()),
    updatedAtRaw: record.updatedAt.getTime(),
    ...(record.parentId ? { parentId: record.parentId } : {}),
    archived: true,
  }
}

async function isArchiveVisible(slug: string): Promise<boolean> {
  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { runtimeKind: true },
  })
  return !!instance && instance.runtimeKind !== null && instance.runtimeKind !== 'opencode-v1'
}

export async function findSession(slug: string, sessionId: string): Promise<ArchivedSession | null> {
  if (!await isArchiveVisible(slug)) return null
  const record = await prisma.legacySessionArchive.findUnique({
    where: { slug_sessionId: { slug, sessionId } },
  })
  if (!record) return null
  return {
    session: toSession(record),
    messages: record.messages as WorkspaceMessage[],
  }
}

export async function listSessions(slug: string): Promise<ArchivedSession['session'][]> {
  if (!await isArchiveVisible(slug)) return []
  const records = await prisma.legacySessionArchive.findMany({
    where: { slug },
    select: { id: true, slug: true, sessionId: true, parentId: true, title: true, createdAt: true, updatedAt: true, archivedAt: true },
    orderBy: [{ updatedAt: 'desc' }, { sessionId: 'asc' }],
  })
  return records.map(toSession)
}

export async function isArchivedSession(slug: string, sessionId: string): Promise<boolean> {
  if (!await isArchiveVisible(slug)) return false
  return await prisma.legacySessionArchive.findUnique({
    where: { slug_sessionId: { slug, sessionId } },
    select: { id: true },
  }) !== null
}

export async function findExportedSession(slug: string, sessionId: string, client: Prisma.TransactionClient = prisma): Promise<(ExportedSessionMetadata & { messages: WorkspaceMessage[]; validatedAt: Date | null }) | null> {
  const record = await client.legacySessionArchive.findUnique({
    where: { slug_sessionId: { slug, sessionId } },
    select: { parentId: true, title: true, createdAt: true, updatedAt: true, messages: true, validatedAt: true },
  })
  return record ? { ...record, messages: record.messages as WorkspaceMessage[] } : null
}

export async function upsertSession(input: ExportedSessionMetadata & {
  slug: string
  sessionId: string
  messages: WorkspaceMessage[]
  validatedAt?: Date | null
}, options: { onlyWhileRunning?: boolean } = {}, client: Prisma.TransactionClient = prisma): Promise<boolean> {
  const data = {
    parentId: input.parentId,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    messages: JSON.parse(JSON.stringify(input.messages)) as Prisma.InputJsonValue,
    archivedAt: new Date(),
    validatedAt: input.validatedAt ?? null,
  }
  const args = {
    where: { slug_sessionId: { slug: input.slug, sessionId: input.sessionId } },
    create: { slug: input.slug, sessionId: input.sessionId, ...data },
    update: data,
  }
  if (!options.onlyWhileRunning) {
    await client.legacySessionArchive.upsert(args)
    return true
  }
  return prisma.$transaction(async (tx) => {
    const instance = await tx.instance.updateMany({
      where: {
        slug: input.slug,
        status: 'running',
        OR: [{ runtimeKind: null }, { runtimeKind: 'opencode-v1' }],
      },
      data: { status: 'running' },
    })
    if (instance.count === 0) return false
    await tx.legacySessionArchive.upsert(args)
    return true
  })
}

export async function withArchiveWriteFence<T>(slug: string, work: (tx: Prisma.TransactionClient) => Promise<T>, options: { onlyWhileRunning?: boolean } = {}): Promise<T | null> {
  return prisma.$transaction(async (tx) => {
    const instance = await tx.instance.updateMany({
      where: {
        slug,
        ...(options.onlyWhileRunning ? { status: 'running' as const } : {}),
        OR: [{ runtimeKind: null }, { runtimeKind: 'opencode-v1' }],
      },
      data: { slug },
    })
    if (instance.count === 0) return null
    return work(tx)
  }, { maxWait: 5_000, timeout: 5_000 })
}

export async function reconcileSessions(slug: string, sessionIds: string[], client: Prisma.TransactionClient): Promise<void> {
  await client.legacySessionArchive.deleteMany({ where: { slug, sessionId: { notIn: sessionIds } } })
}

export async function findNextRunningV1Instance(afterSlug?: string): Promise<{ slug: string } | null> {
  const where = {
    status: 'running' as const,
    OR: [{ runtimeKind: null }, { runtimeKind: 'opencode-v1' }],
  }
  const next = await prisma.instance.findFirst({
    where: { ...where, ...(afterSlug ? { slug: { gt: afterSlug } } : {}) },
    orderBy: { slug: 'asc' },
    select: { slug: true },
  })
  if (next || !afterSlug) return next
  return prisma.instance.findFirst({ where, orderBy: { slug: 'asc' }, select: { slug: true } })
}
