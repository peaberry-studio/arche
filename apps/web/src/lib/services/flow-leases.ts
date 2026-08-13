import { FlowRunStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  availableLease,
  FLOW_USER_SELECT,
  noActiveRun,
  type FlowClaimedRecord,
  type FlowRecord,
  type FlowRetryClaimedRecord,
  type FlowRunDetailRecord,
} from '@/lib/services/flow-records'

const FLOW_RETRY_RUN_INCLUDE = {
  flow: true,
  executionUser: {
    select: FLOW_USER_SELECT,
  },
  steps: {
    orderBy: { createdAt: 'asc' as const },
  },
}

export async function recoverStaleRunningRuns(now: Date): Promise<number> {
  const result = await prisma.flowRun.updateMany({
    data: {
      currentNodeId: null,
      error: 'flow_run_stale_recovered',
      finishedAt: now,
      status: FlowRunStatus.failed,
    },
    where: {
      flow: {
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: now } },
        ],
      },
      retryScheduledFor: null,
      status: FlowRunStatus.running,
    },
  })

  return result.count
}

export async function claimNextDueFlow(params: {
  leaseMs: number
  leaseOwner: string
  now: Date
  resolveNextRunAt: (flow: FlowRecord) => Date | null
}): Promise<FlowClaimedRecord | null> {
  await recoverStaleRunningRuns(params.now)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const flow = await prisma.flow.findFirst({
      orderBy: [
        { nextRunAt: 'asc' },
        { createdAt: 'asc' },
      ],
      where: {
        enabled: true,
        deletedAt: null,
        nextRunAt: { lte: params.now },
        OR: availableLease(params.now),
        ...noActiveRun(),
      },
    })

    if (!flow || !flow.nextRunAt) {
      return null
    }

    const nextRunAt = params.resolveNextRunAt(flow)
    const scheduledFor = flow.nextRunAt
    const leaseExpiresAt = new Date(params.now.getTime() + params.leaseMs)
    const claimed = await prisma.flow.updateMany({
      data: {
        leaseExpiresAt,
        leaseOwner: params.leaseOwner,
        nextRunAt,
      },
      where: {
        enabled: true,
        deletedAt: null,
        id: flow.id,
        nextRunAt: flow.nextRunAt,
        OR: availableLease(params.now),
        ...noActiveRun(),
      },
    })

    if (claimed.count === 1) {
      console.log('[flows] Flow claimed', {
        flowId: flow.id,
        scheduledFor: scheduledFor.toISOString(),
        userId: flow.userId,
      })

      return {
        ...flow,
        leaseExpiresAt,
        leaseOwner: params.leaseOwner,
        nextRunAt,
        scheduledFor,
      }
    }
  }

  return null
}

export async function claimNextRetryRun(params: {
  leaseMs: number
  leaseOwner: string
  now: Date
}): Promise<FlowRetryClaimedRecord | null> {
  await recoverStaleRunningRuns(params.now)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const run = await prisma.flowRun.findFirst({
      include: FLOW_RETRY_RUN_INCLUDE,
      orderBy: [
        { retryScheduledFor: 'asc' },
        { createdAt: 'asc' },
      ],
      where: {
        retryScheduledFor: { lte: params.now },
        status: FlowRunStatus.running,
        flow: {
          deletedAt: null,
          OR: availableLease(params.now),
        },
      },
    })

    if (!run || !run.retryScheduledFor) return null

    const leaseExpiresAt = new Date(params.now.getTime() + params.leaseMs)
    const claimedFlow = await prisma.flow.updateMany({
      data: {
        leaseExpiresAt,
        leaseOwner: params.leaseOwner,
      },
      where: {
        deletedAt: null,
        id: run.flowId,
        OR: availableLease(params.now),
      },
    })

    if (claimedFlow.count !== 1) continue

    const claimedRun = await prisma.flowRun.updateMany({
      data: { retryScheduledFor: null },
      where: {
        id: run.id,
        retryScheduledFor: run.retryScheduledFor,
        status: FlowRunStatus.running,
      },
    })

    if (claimedRun.count !== 1) {
      await releaseFlowLease(run.flowId, params.leaseOwner).catch(() => undefined)
      continue
    }

    console.log('[flows] Flow retry claimed', {
      attempt: run.attempt,
      flowId: run.flowId,
      runId: run.id,
      scheduledFor: run.scheduledFor.toISOString(),
      userId: run.flow.userId,
    })

    const flow = {
      ...run.flow,
      leaseExpiresAt,
      leaseOwner: params.leaseOwner,
    }

    return {
      ...flow,
      retryRun: {
        ...run,
        flow,
        retryScheduledFor: null,
      } satisfies FlowRunDetailRecord,
      scheduledFor: run.scheduledFor,
    }
  }

  return null
}

export async function claimFlowForImmediateRun(params: {
  id: string
  leaseMs: number
  leaseOwner: string
  now: Date
  ownerUserId?: string
}): Promise<FlowClaimedRecord | null> {
  await recoverStaleRunningRuns(params.now)

  const flow = await prisma.flow.findFirst({
    where: {
      id: params.id,
      deletedAt: null,
      ...(params.ownerUserId ? { userId: params.ownerUserId } : {}),
      OR: availableLease(params.now),
      ...noActiveRun(),
    },
  })

  if (!flow) return null

  const leaseExpiresAt = new Date(params.now.getTime() + params.leaseMs)
  const claimed = await prisma.flow.updateMany({
    data: {
      leaseExpiresAt,
      leaseOwner: params.leaseOwner,
    },
    where: {
      id: flow.id,
      deletedAt: null,
      ...(params.ownerUserId ? { userId: params.ownerUserId } : {}),
      OR: availableLease(params.now),
      ...noActiveRun(),
    },
  })

  if (claimed.count !== 1) return null

  return {
    ...flow,
    leaseExpiresAt,
    leaseOwner: params.leaseOwner,
    scheduledFor: params.now,
  }
}

export async function claimFlowLeaseById(params: {
  id: string
  leaseMs: number
  leaseOwner: string
  now: Date
  ownerUserId: string
}): Promise<FlowRecord | null> {
  const flow = await prisma.flow.findFirst({
    where: {
      id: params.id,
      userId: params.ownerUserId,
      OR: availableLease(params.now),
    },
  })

  if (!flow) return null

  const leaseExpiresAt = new Date(params.now.getTime() + params.leaseMs)
  const claimed = await prisma.flow.updateMany({
    data: {
      leaseExpiresAt,
      leaseOwner: params.leaseOwner,
    },
    where: {
      id: flow.id,
      userId: params.ownerUserId,
      OR: availableLease(params.now),
    },
  })

  if (claimed.count !== 1) return null

  return {
    ...flow,
    leaseExpiresAt,
    leaseOwner: params.leaseOwner,
  }
}

export function extendFlowLease(id: string, leaseOwner: string, leaseExpiresAt: Date) {
  return prisma.flow.updateMany({
    data: { leaseExpiresAt },
    where: { id, leaseOwner },
  })
}

export function releaseFlowLease(id: string, leaseOwner: string, lastRunAt?: Date) {
  return prisma.flow.updateMany({
    data: {
      lastRunAt,
      leaseExpiresAt: null,
      leaseOwner: null,
    },
    where: { id, leaseOwner },
  })
}
