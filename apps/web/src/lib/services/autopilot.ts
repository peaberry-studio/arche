import { AutopilotRunStatus, Prisma } from '@prisma/client'
import type { AutopilotRunTrigger } from '@prisma/client'

import type { AutopilotSlackNotificationConfig } from '@/lib/autopilot/types'
import { prisma } from '@/lib/prisma'

export type AutopilotTaskRecord = {
  id: string
  userId: string
  name: string
  prompt: string
  targetAgentId: string | null
  cronExpression: string
  timezone: string
  enabled: boolean
  nextRunAt: Date
  lastRunAt: Date | null
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  retryAttempt: number
  retryScheduledFor: Date | null
  slackNotificationConfig?: Prisma.JsonValue | null
  createdAt: Date
  updatedAt: Date
}

export type AutopilotRunRecord = {
  id: string
  taskId: string
  status: AutopilotRunStatus
  trigger: AutopilotRunTrigger
  scheduledFor: Date
  attempt: number
  startedAt: Date
  finishedAt: Date | null
  error: string | null
  openCodeSessionId: string | null
  sessionTitle: string | null
  resultSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type AutopilotTaskListRecord = AutopilotTaskRecord & {
  runs: AutopilotRunRecord[]
}

export type AutopilotTaskDetailRecord = AutopilotTaskRecord & {
  runs: AutopilotRunRecord[]
}

export type AutopilotClaimedTask = AutopilotTaskRecord & {
  scheduledFor: Date
}

export type AutopilotClaimConcurrencyPolicy = 'per_user' | 'task_only'

type LeaseScope = {
  leaseExpiresAt: null
} | {
  leaseExpiresAt: {
    lt: Date
  }
}

type SessionMetadataRecord = {
  openCodeSessionId: string
  trigger: AutopilotRunTrigger
  taskId: string
  taskName: string
  runId: string
  hasUnseenResult: boolean
}

const TASK_RUN_INCLUDE = {
  runs: {
    orderBy: { startedAt: 'desc' as const },
    take: 1,
  },
}

const TASK_DETAIL_INCLUDE = {
  runs: {
    orderBy: { startedAt: 'desc' as const },
    take: 50,
  },
}

function slackNotificationConfigToJson(
  config: AutopilotSlackNotificationConfig,
): Prisma.InputJsonObject {
  return {
    enabled: config.enabled,
    includeSessionLink: config.includeSessionLink,
    targets: config.targets.map((target) => {
      if (target.type === 'dm') {
        return {
          type: 'dm',
          userId: target.userId,
        }
      }

      return {
        type: 'channel',
        channelId: target.channelId,
      }
    }),
  }
}

function availableLease(now: Date): LeaseScope[] {
  return [
    { leaseExpiresAt: null },
    { leaseExpiresAt: { lt: now } },
  ]
}

function noActiveUserLease(now: Date) {
  return {
    user: {
      autopilotTasks: {
        none: {
          leaseExpiresAt: {
            gt: now,
          },
        },
      },
    },
  }
}

function claimAvailabilityWhere(
  now: Date,
  concurrencyPolicy: AutopilotClaimConcurrencyPolicy,
): Prisma.AutopilotTaskWhereInput {
  return {
    OR: availableLease(now),
    ...(concurrencyPolicy === 'per_user' ? noActiveUserLease(now) : {}),
  }
}

export async function listTasksByUserId(userId: string): Promise<AutopilotTaskListRecord[]> {
  return prisma.autopilotTask.findMany({
    where: { userId },
    include: TASK_RUN_INCLUDE,
    orderBy: [
      { enabled: 'desc' },
      { nextRunAt: 'asc' },
      { createdAt: 'asc' },
    ],
  })
}

export async function findTaskByIdAndUserId(id: string, userId: string): Promise<AutopilotTaskDetailRecord | null> {
  return prisma.autopilotTask.findFirst({
    where: { id, userId },
    include: TASK_DETAIL_INCLUDE,
  })
}

export async function createTask(data: {
  userId: string
  name: string
  prompt: string
  targetAgentId?: string | null
  cronExpression: string
  timezone: string
  enabled: boolean
  nextRunAt: Date
  slackNotificationConfig?: AutopilotSlackNotificationConfig | null
}): Promise<AutopilotTaskRecord> {
  return prisma.autopilotTask.create({
    data: {
      userId: data.userId,
      name: data.name,
      prompt: data.prompt,
      targetAgentId: data.targetAgentId ?? null,
      cronExpression: data.cronExpression,
      timezone: data.timezone,
      enabled: data.enabled,
      nextRunAt: data.nextRunAt,
      ...(data.slackNotificationConfig
        ? { slackNotificationConfig: slackNotificationConfigToJson(data.slackNotificationConfig) }
        : {}),
    },
  })
}

export async function updateTaskByIdAndUserId(
  id: string,
  userId: string,
  data: {
    name?: string
    prompt?: string
    targetAgentId?: string | null
    cronExpression?: string
    timezone?: string
    enabled?: boolean
    nextRunAt?: Date
    slackNotificationConfig?: AutopilotSlackNotificationConfig | null
  },
): Promise<AutopilotTaskRecord | null> {
  const { slackNotificationConfig, ...taskData } = data
  const updateData: Prisma.AutopilotTaskUpdateManyMutationInput = { ...taskData }
  if ('slackNotificationConfig' in data) {
    updateData.slackNotificationConfig = slackNotificationConfig
      ? slackNotificationConfigToJson(slackNotificationConfig)
      : Prisma.DbNull
  }

  const result = await prisma.autopilotTask.updateMany({
    where: { id, userId },
    data: updateData,
  })
  if (result.count === 0) return null
  return prisma.autopilotTask.findFirst({ where: { id, userId } })
}

export function deleteTaskByIdAndUserId(id: string, userId: string) {
  return prisma.autopilotTask.deleteMany({ where: { id, userId } })
}

export async function claimNextDueTask(params: {
  leaseMs: number
  leaseOwner: string
  now: Date
  resolveNextRunAt: (task: AutopilotTaskRecord) => Date
}): Promise<AutopilotClaimedTask | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const task = await prisma.autopilotTask.findFirst({
      where: {
        enabled: true,
        nextRunAt: { lte: params.now },
        ...claimAvailabilityWhere(params.now, 'per_user'),
      },
      orderBy: [
        { nextRunAt: 'asc' },
        { createdAt: 'asc' },
      ],
    })

    if (!task) {
      return null
    }

    // Product currently prefers best-effort, at-most-once scheduling semantics.
    // We advance nextRunAt as part of the lease claim, so a process crash after
    // claiming but before execution can skip the current slot instead of replaying it.
    const nextRunAt = params.resolveNextRunAt(task)
    const scheduledFor = task.retryScheduledFor ?? task.nextRunAt
    const leaseExpiresAt = new Date(params.now.getTime() + params.leaseMs)
    const claimed = await prisma.autopilotTask.updateMany({
      where: {
        id: task.id,
        enabled: true,
        nextRunAt: task.nextRunAt,
        ...claimAvailabilityWhere(params.now, 'per_user'),
      },
      data: {
        leaseOwner: params.leaseOwner,
        leaseExpiresAt,
        nextRunAt,
      },
    })

    if (claimed.count === 1) {
      console.log('[autopilot] Task claimed', {
        taskId: task.id,
        userId: task.userId,
        scheduledFor: scheduledFor.toISOString(),
        retryAttempt: task.retryAttempt,
      })

      return {
        ...task,
        leaseOwner: params.leaseOwner,
        leaseExpiresAt,
        nextRunAt,
        scheduledFor,
      }
    }
  }

  return null
}

export async function claimTaskForImmediateRun(params: {
  id: string
  leaseMs: number
  leaseOwner: string
  now: Date
  userId?: string
  concurrencyPolicy?: AutopilotClaimConcurrencyPolicy
}): Promise<AutopilotClaimedTask | null> {
  const concurrencyPolicy = params.concurrencyPolicy ?? 'task_only'
  const task = await prisma.autopilotTask.findFirst({
    where: {
      id: params.id,
      ...(params.userId ? { userId: params.userId } : {}),
      ...claimAvailabilityWhere(params.now, concurrencyPolicy),
    },
  })

  if (!task) {
    return null
  }

  const leaseExpiresAt = new Date(params.now.getTime() + params.leaseMs)
  const claimed = await prisma.autopilotTask.updateMany({
    where: {
      id: task.id,
      ...(params.userId ? { userId: params.userId } : {}),
      ...claimAvailabilityWhere(params.now, concurrencyPolicy),
    },
    data: {
      leaseOwner: params.leaseOwner,
      leaseExpiresAt,
    },
  })

  if (claimed.count !== 1) {
    return null
  }

  return {
    ...task,
    leaseOwner: params.leaseOwner,
    leaseExpiresAt,
    scheduledFor: params.now,
  }
}

export function extendTaskLease(id: string, leaseOwner: string, leaseExpiresAt: Date) {
  return prisma.autopilotTask.updateMany({
    where: {
      id,
      leaseOwner,
    },
    data: {
      leaseExpiresAt,
    },
  })
}

export function releaseTaskLease(id: string, leaseOwner: string, lastRunAt: Date) {
  return prisma.autopilotTask.updateMany({
    where: {
      id,
      leaseOwner,
    },
    data: {
      lastRunAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  })
}

export function createRun(data: {
  taskId: string
  status?: AutopilotRunStatus
  trigger: AutopilotRunTrigger
  scheduledFor: Date
  startedAt?: Date
  attempt?: number
}): Promise<AutopilotRunRecord> {
  return prisma.autopilotRun.create({
    data: {
      taskId: data.taskId,
      status: data.status ?? AutopilotRunStatus.running,
      trigger: data.trigger,
      scheduledFor: data.scheduledFor,
      attempt: data.attempt ?? 1,
      startedAt: data.startedAt,
    },
  })
}

export function scheduleTaskRetry(data: {
  taskId: string
  leaseOwner: string
  retryAttempt: number
  retryAt: Date
  retryScheduledFor: Date
}) {
  return prisma.autopilotTask.updateMany({
    where: {
      id: data.taskId,
      leaseOwner: data.leaseOwner,
    },
    data: {
      nextRunAt: data.retryAt,
      retryAttempt: data.retryAttempt,
      retryScheduledFor: data.retryScheduledFor,
    },
  })
}

export function clearTaskRetryState(id: string, leaseOwner: string) {
  return prisma.autopilotTask.updateMany({
    where: {
      id,
      leaseOwner,
    },
    data: {
      retryAttempt: 0,
      retryScheduledFor: null,
    },
  })
}

export function markRunSucceeded(id: string, data: { finishedAt: Date; openCodeSessionId?: string | null; sessionTitle?: string | null }) {
  return prisma.autopilotRun.update({
    where: { id },
    data: {
      status: AutopilotRunStatus.succeeded,
      finishedAt: data.finishedAt,
      openCodeSessionId: data.openCodeSessionId ?? null,
      sessionTitle: data.sessionTitle ?? null,
    },
  })
}

export function markRunFailed(id: string, data: { error: string; finishedAt: Date; openCodeSessionId?: string | null; sessionTitle?: string | null }) {
  return prisma.autopilotRun.update({
    where: { id },
    data: {
      status: AutopilotRunStatus.failed,
      error: data.error,
      finishedAt: data.finishedAt,
      openCodeSessionId: data.openCodeSessionId ?? null,
      sessionTitle: data.sessionTitle ?? null,
    },
  })
}

export function attachRunSession(id: string, data: { openCodeSessionId: string; sessionTitle: string }) {
  return prisma.autopilotRun.update({
    where: { id },
    data: {
      openCodeSessionId: data.openCodeSessionId,
      sessionTitle: data.sessionTitle,
    },
  })
}

export async function markRunResultSeenByIdAndUserId(id: string, userId: string, seenAt: Date): Promise<boolean> {
  const run = await prisma.autopilotRun.findFirst({
    where: {
      id,
      task: {
        userId,
      },
    },
    select: {
      id: true,
      resultSeenAt: true,
      status: true,
    },
  })

  if (!run) {
    return false
  }

  if (run.status === AutopilotRunStatus.running || run.resultSeenAt) {
    return true
  }

  const result = await prisma.autopilotRun.updateMany({
    where: {
      id,
      resultSeenAt: null,
    },
    data: {
      resultSeenAt: seenAt,
    },
  })

  return result.count === 1
}

export async function findSessionMetadataByUserId(userId: string, sessionIds: string[]): Promise<SessionMetadataRecord[]> {
  if (sessionIds.length === 0) return []

  return prisma.autopilotRun.findMany({
    where: {
      openCodeSessionId: {
        in: sessionIds,
      },
      task: {
        userId,
      },
    },
    select: {
      id: true,
      trigger: true,
      openCodeSessionId: true,
      resultSeenAt: true,
      status: true,
      task: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  }).then((runs) =>
    runs.flatMap((run) => {
      if (!run.openCodeSessionId) {
        return []
      }

      return [{
        openCodeSessionId: run.openCodeSessionId,
        trigger: run.trigger,
        taskId: run.task.id,
        taskName: run.task.name,
        runId: run.id,
        hasUnseenResult:
          run.status !== AutopilotRunStatus.running &&
          run.resultSeenAt === null,
      }]
    })
  )
}
