import {
  FlowRunStatus,
  FlowVisibility,
  Prisma,
} from '@prisma/client'

import {
  flowVisibleToWorkspaceWhere,
  runVisibleToWorkspaceWhere,
  type FlowActorScope,
} from '@/lib/flows/authorization'
import { prisma } from '@/lib/prisma'
import {
  ACTIVE_RUN_STATUSES,
  FLOW_USER_SELECT,
  normalizeOrganizationCanRun,
  type FlowDetailRecord,
  type FlowListRecord,
  type FlowRecord,
} from '@/lib/services/flow-records'

function flowRunInclude(scope: FlowActorScope, take: number) {
  return {
    runs: {
      include: {
        executionUser: {
          select: FLOW_USER_SELECT,
        },
        steps: {
          orderBy: { createdAt: 'asc' as const },
        },
      },
      orderBy: { startedAt: 'desc' as const },
      take,
      where: runVisibleToWorkspaceWhere(scope),
    },
    user: {
      select: FLOW_USER_SELECT,
    },
  }
}

export async function listFlowsForScope(scope: FlowActorScope): Promise<FlowListRecord[]> {
  return prisma.flow.findMany({
    include: flowRunInclude(scope, 1),
    orderBy: [
      { enabled: 'desc' },
      { updatedAt: 'desc' },
      { createdAt: 'asc' },
    ],
    where: flowVisibleToWorkspaceWhere(scope),
  })
}

export async function findFlowByIdForScope(id: string, scope: FlowActorScope): Promise<FlowDetailRecord | null> {
  return prisma.flow.findFirst({
    include: flowRunInclude(scope, 50),
    where: { ...flowVisibleToWorkspaceWhere(scope), id },
  })
}

export async function createFlow(data: {
  cronExpression?: string | null
  definition: Prisma.InputJsonValue
  description?: string | null
  enabled: boolean
  name: string
  nextRunAt?: Date | null
  organizationCanRun?: boolean
  timezone: string
  userId: string
  visibility?: FlowVisibility
}): Promise<FlowRecord> {
  const visibility = data.visibility ?? FlowVisibility.private

  return prisma.flow.create({
    data: {
      cronExpression: data.cronExpression ?? null,
      definition: data.definition,
      description: data.description ?? null,
      enabled: data.enabled,
      name: data.name,
      nextRunAt: data.nextRunAt ?? null,
      organizationCanRun: normalizeOrganizationCanRun(visibility, data.organizationCanRun) ?? false,
      timezone: data.timezone,
      userId: data.userId,
      visibility,
    },
  })
}

export async function updateFlowByIdAndOwnerId(
  id: string,
  ownerUserId: string,
  data: {
    cronExpression?: string | null
    definition?: Prisma.InputJsonValue
    description?: string | null
    enabled?: boolean
    name?: string
    nextRunAt?: Date | null
    organizationCanRun?: boolean
    timezone?: string
    visibility?: FlowVisibility
  },
): Promise<FlowRecord | null> {
  const existing = await prisma.flow.findFirst({
    select: { visibility: true },
    where: { deletedAt: null, id, userId: ownerUserId },
  })
  if (!existing) return null

  const nextVisibility = data.visibility ?? existing.visibility
  const normalizedData = {
    ...data,
    organizationCanRun: normalizeOrganizationCanRun(nextVisibility, data.organizationCanRun),
  }

  const result = await prisma.flow.updateMany({
    data: normalizedData,
    where: { deletedAt: null, id, userId: ownerUserId, visibility: existing.visibility },
  })
  if (result.count === 0) return null
  return prisma.flow.findFirst({ where: { deletedAt: null, id, userId: ownerUserId } })
}

export async function deleteFlowByIdAndOwnerId(id: string, ownerUserId: string) {
  const deletedAt = new Date()
  const result = await prisma.flow.updateMany({
    data: {
      deletedAt,
      enabled: false,
      leaseExpiresAt: null,
      leaseOwner: null,
      nextRunAt: null,
    },
    where: { deletedAt: null, id, userId: ownerUserId },
  })

  if (result.count === 0) return result

  await prisma.flowRun.updateMany({
    data: {
      currentNodeId: null,
      finishedAt: deletedAt,
      retryScheduledFor: null,
      status: FlowRunStatus.cancelled,
    },
    where: {
      flowId: id,
      status: { in: ACTIVE_RUN_STATUSES },
    },
  })

  return result
}
