import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Query return shapes
// ---------------------------------------------------------------------------

export type ConnectorListEntry = {
  id: string
  type: string
  name: string
  enabled: boolean
  config: string
  createdAt: Date
}

export type ConnectorEnabledEntry = {
  id: string
  type: string
  enabled: boolean
}

export type ConnectorMcpEntry = {
  id: string
  type: string
  name: string
  config: string
  enabled: boolean
}

export type ConnectorHashEntry = {
  id: string
  type: string
  enabled: boolean
  updatedAt: Date
}

export type ConnectorFullRecord = {
  id: string
  userId: string
  type: string
  name: string
  config: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findManyByUserId(userId: string): Promise<ConnectorListEntry[]> {
  return prisma.connector.findMany({
    where: { userId },
    select: { id: true, type: true, name: true, enabled: true, config: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
}

export function findEnabledByUserId(userId: string): Promise<ConnectorEnabledEntry[]> {
  return prisma.connector.findMany({
    where: { userId, enabled: true },
    select: { id: true, type: true, enabled: true },
  })
}

export function findEnabledMcpByUserId(userId: string): Promise<ConnectorMcpEntry[]> {
  return prisma.connector.findMany({
    where: { userId, enabled: true },
    select: { id: true, type: true, name: true, config: true, enabled: true },
  })
}

export function findHashEntriesByUserId(userId: string): Promise<ConnectorHashEntry[]> {
  return prisma.connector.findMany({
    where: { userId },
    select: { id: true, type: true, enabled: true, updatedAt: true },
    orderBy: { id: 'asc' },
  })
}

export function findByIdAndUserId(id: string, userId: string): Promise<ConnectorFullRecord | null> {
  return prisma.connector.findFirst({ where: { id, userId } })
}

export function findByIdAndUserIdSelect<T extends Record<string, boolean>>(
  id: string,
  userId: string,
  select: T,
) {
  return prisma.connector.findFirst({ where: { id, userId }, select })
}

export function findById(id: string) {
  return prisma.connector.findUnique({ where: { id } })
}

export function findFirstByUserIdAndType(userId: string, type: string) {
  return prisma.connector.findFirst({
    where: { userId, type },
    select: { id: true },
  })
}

export function findEnabledByIdAndUserId(id: string, userId: string) {
  return prisma.connector.findFirst({
    where: { id, userId, enabled: true },
    select: { id: true, type: true, config: true, userId: true },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function create(data: {
  userId: string
  type: string
  name: string
  config: string
  enabled: boolean
}) {
  return prisma.connector.create({
    data,
    select: { id: true, type: true, name: true, enabled: true, createdAt: true },
  })
}

/** Update a connector by ID without ownership check. Only use from internal/system flows
 *  (e.g. OAuth token refresh) where the connector was already validated upstream.
 *  For user-facing routes, use updateManyByIdAndUserId instead. */
export function updateByIdUnsafe(id: string, data: Record<string, unknown>) {
  return prisma.connector.update({
    where: { id },
    data,
  })
}

export function updateManyByIdAndUserId(id: string, userId: string, data: Record<string, unknown>) {
  return prisma.connector.updateMany({
    where: { id, userId },
    data,
  })
}

export function deleteManyByIdAndUserId(id: string, userId: string) {
  return prisma.connector.deleteMany({ where: { id, userId } })
}
