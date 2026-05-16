import {
  FlowNodeType,
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTrigger,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type FlowRecord = {
  id: string
  userId: string
  name: string
  description: string | null
  definition: unknown
  cronExpression: string | null
  timezone: string
  enabled: boolean
  nextRunAt: Date | null
  lastRunAt: Date | null
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export type FlowRunStepRecord = {
  id: string
  runId: string
  nodeId: string
  nodeName: string | null
  nodeType: FlowNodeType
  status: FlowRunStepStatus
  input: unknown
  rawOutput: string | null
  compactedOutput: string | null
  humanResponse: string | null
  error: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type FlowRunRecord = {
  id: string
  flowId: string
  status: FlowRunStatus
  trigger: FlowRunTrigger
  scheduledFor: Date
  startedAt: Date
  finishedAt: Date | null
  error: string | null
  openCodeSessionId: string | null
  sessionTitle: string | null
  currentNodeId: string | null
  resultSeenAt: Date | null
  attempt: number
  retryScheduledFor: Date | null
  lastRetryError: string | null
  createdAt: Date
  updatedAt: Date
}

export type FlowListRecord = FlowRecord & {
  runs: Array<FlowRunRecord & { steps: FlowRunStepRecord[] }>
}

export type FlowDetailRecord = FlowRecord & {
  runs: Array<FlowRunRecord & { steps: FlowRunStepRecord[] }>
}

export type FlowRunDetailRecord = FlowRunRecord & {
  flow: FlowRecord
  steps: FlowRunStepRecord[]
}

export type FlowClaimedRecord = FlowRecord & {
  scheduledFor: Date
}

export type FlowRetryClaimedRecord = FlowRecord & {
  retryRun: FlowRunDetailRecord
  scheduledFor: Date
}

type LeaseScope =
  | { leaseExpiresAt: null }
  | { leaseExpiresAt: { lt: Date } }

type SessionMetadataRecord = {
  openCodeSessionId: string
  trigger: FlowRunTrigger
  flowId: string
  flowName: string
  runId: string
  status: FlowRunStatus
  hasUnseenResult: boolean
}

const ACTIVE_RUN_STATUSES: FlowRunStatus[] = [
  FlowRunStatus.running,
  FlowRunStatus.waiting_for_human,
]

const FLOW_RUN_INCLUDE = {
  runs: {
    include: {
      steps: {
        orderBy: { createdAt: 'asc' as const },
      },
    },
    orderBy: { startedAt: 'desc' as const },
    take: 1,
  },
}

const FLOW_DETAIL_INCLUDE = {
  runs: {
    include: {
      steps: {
        orderBy: { createdAt: 'asc' as const },
      },
    },
    orderBy: { startedAt: 'desc' as const },
    take: 50,
  },
}

const FLOW_RETRY_RUN_INCLUDE = {
  flow: true,
  steps: {
    orderBy: { createdAt: 'asc' as const },
  },
}

function availableLease(now: Date): LeaseScope[] {
  return [
    { leaseExpiresAt: null },
    { leaseExpiresAt: { lt: now } },
  ]
}

function noActiveRun() {
  return {
    runs: {
      none: {
        status: {
          in: ACTIVE_RUN_STATUSES,
        },
      },
    },
  }
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
        leaseExpiresAt: { lt: now },
      },
      retryScheduledFor: null,
      status: FlowRunStatus.running,
    },
  })

  return result.count
}

export async function listFlowsByUserId(userId: string): Promise<FlowListRecord[]> {
  return prisma.flow.findMany({
    include: FLOW_RUN_INCLUDE,
    orderBy: [
      { enabled: 'desc' },
      { updatedAt: 'desc' },
      { createdAt: 'asc' },
    ],
    where: { deletedAt: null, userId },
  })
}

export async function findFlowByIdAndUserId(id: string, userId: string): Promise<FlowDetailRecord | null> {
  return prisma.flow.findFirst({
    include: FLOW_DETAIL_INCLUDE,
    where: { deletedAt: null, id, userId },
  })
}

export async function createFlow(data: {
  cronExpression?: string | null
  definition: Prisma.InputJsonValue
  description?: string | null
  enabled: boolean
  name: string
  nextRunAt?: Date | null
  timezone: string
  userId: string
}): Promise<FlowRecord> {
  return prisma.flow.create({
    data: {
      cronExpression: data.cronExpression ?? null,
      definition: data.definition,
      description: data.description ?? null,
      enabled: data.enabled,
      name: data.name,
      nextRunAt: data.nextRunAt ?? null,
      timezone: data.timezone,
      userId: data.userId,
    },
  })
}

export async function updateFlowByIdAndUserId(
  id: string,
  userId: string,
  data: {
    cronExpression?: string | null
    definition?: Prisma.InputJsonValue
    description?: string | null
    enabled?: boolean
    name?: string
    nextRunAt?: Date | null
    timezone?: string
  },
): Promise<FlowRecord | null> {
  const result = await prisma.flow.updateMany({
    data,
    where: { deletedAt: null, id, userId },
  })
  if (result.count === 0) return null
  return prisma.flow.findFirst({ where: { deletedAt: null, id, userId } })
}

export async function deleteFlowByIdAndUserId(id: string, userId: string) {
  const deletedAt = new Date()
  const result = await prisma.flow.updateMany({
    data: {
      deletedAt,
      enabled: false,
      leaseExpiresAt: null,
      leaseOwner: null,
      nextRunAt: null,
    },
    where: { deletedAt: null, id, userId },
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
      },
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
  userId?: string
}): Promise<FlowClaimedRecord | null> {
  await recoverStaleRunningRuns(params.now)

  const flow = await prisma.flow.findFirst({
    where: {
      id: params.id,
      deletedAt: null,
      ...(params.userId ? { userId: params.userId } : {}),
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
      ...(params.userId ? { userId: params.userId } : {}),
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
  userId: string
}): Promise<FlowRecord | null> {
  const flow = await prisma.flow.findFirst({
    where: {
      id: params.id,
      userId: params.userId,
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
      userId: params.userId,
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

export function createRun(data: {
  attempt?: number
  flowId: string
  scheduledFor: Date
  status?: FlowRunStatus
  trigger: FlowRunTrigger
}): Promise<FlowRunRecord> {
  return prisma.flowRun.create({
    data: {
      flowId: data.flowId,
      attempt: data.attempt ?? 1,
      scheduledFor: data.scheduledFor,
      status: data.status ?? FlowRunStatus.running,
      trigger: data.trigger,
    },
  })
}

export function findRunStatusById(id: string): Promise<{ status: FlowRunStatus } | null> {
  return prisma.flowRun.findUnique({
    select: { status: true },
    where: { id },
  })
}

export function attachRunSession(id: string, data: { openCodeSessionId: string; sessionTitle: string }) {
  return prisma.flowRun.update({
    data: {
      openCodeSessionId: data.openCodeSessionId,
      sessionTitle: data.sessionTitle,
    },
    where: { id },
  })
}

export function updateRunCurrentNode(id: string, currentNodeId: string | null) {
  return prisma.flowRun.update({
    data: { currentNodeId },
    where: { id },
  })
}

export function markRunWaitingForHuman(id: string, currentNodeId: string) {
  return prisma.flowRun.update({
    data: {
      currentNodeId,
      status: FlowRunStatus.waiting_for_human,
    },
    where: { id },
  })
}

export function markRunRunning(id: string) {
  return prisma.flowRun.update({
    data: { status: FlowRunStatus.running },
    where: { id },
  })
}

export function markRunSucceeded(id: string, data: { finishedAt: Date; openCodeSessionId?: string | null; sessionTitle?: string | null }) {
  return prisma.flowRun.updateMany({
    data: {
      currentNodeId: null,
      finishedAt: data.finishedAt,
      openCodeSessionId: data.openCodeSessionId ?? null,
      retryScheduledFor: null,
      lastRetryError: null,
      sessionTitle: data.sessionTitle ?? null,
      status: FlowRunStatus.succeeded,
    },
    where: { id, status: FlowRunStatus.running },
  })
}

export function markRunFailed(id: string, data: { error: string; finishedAt: Date; openCodeSessionId?: string | null; sessionTitle?: string | null }) {
  return prisma.flowRun.updateMany({
    data: {
      error: data.error,
      finishedAt: data.finishedAt,
      openCodeSessionId: data.openCodeSessionId ?? null,
      retryScheduledFor: null,
      lastRetryError: data.error,
      sessionTitle: data.sessionTitle ?? null,
      status: FlowRunStatus.failed,
    },
    where: { id, status: FlowRunStatus.running },
  })
}

export function markRunRetryScheduled(id: string, data: { attempt: number; error: string; retryAt: Date; sessionTitle?: string | null; openCodeSessionId?: string | null }) {
  return prisma.flowRun.updateMany({
    data: {
      attempt: data.attempt,
      error: null,
      lastRetryError: data.error,
      openCodeSessionId: data.openCodeSessionId ?? null,
      retryScheduledFor: data.retryAt,
      sessionTitle: data.sessionTitle ?? null,
      status: FlowRunStatus.running,
    },
    where: { id, status: FlowRunStatus.running },
  })
}

export async function cancelRunByIdAndUserId(id: string, userId: string, cancelledAt: Date): Promise<boolean> {
  const result = await prisma.flowRun.updateMany({
    data: {
      finishedAt: cancelledAt,
      status: FlowRunStatus.cancelled,
    },
    where: {
      flow: { userId },
      id,
      status: { in: ACTIVE_RUN_STATUSES },
    },
  })

  return result.count === 1
}

export async function upsertRunStep(data: {
  error?: string | null
  finishedAt?: Date | null
  humanResponse?: string | null
  input?: Prisma.InputJsonValue | null
  nodeId: string
  nodeName?: string | null
  nodeType: FlowNodeType
  rawOutput?: string | null
  compactedOutput?: string | null
  runId: string
  startedAt?: Date | null
  status: FlowRunStepStatus
}): Promise<FlowRunStepRecord> {
  return prisma.flowRunStep.upsert({
    create: {
      compactedOutput: data.compactedOutput ?? null,
      error: data.error ?? null,
      finishedAt: data.finishedAt ?? null,
      humanResponse: data.humanResponse ?? null,
      input: data.input ?? undefined,
      nodeId: data.nodeId,
      nodeName: data.nodeName ?? null,
      nodeType: data.nodeType,
      rawOutput: data.rawOutput ?? null,
      runId: data.runId,
      startedAt: data.startedAt ?? null,
      status: data.status,
    },
    update: {
      compactedOutput: data.compactedOutput,
      error: data.error,
      finishedAt: data.finishedAt,
      humanResponse: data.humanResponse,
      input: data.input ?? undefined,
      nodeName: data.nodeName,
      nodeType: data.nodeType,
      rawOutput: data.rawOutput,
      startedAt: data.startedAt,
      status: data.status,
    },
    where: {
      runId_nodeId: {
        nodeId: data.nodeId,
        runId: data.runId,
      },
    },
  })
}

export function updateRunStepByRunIdAndNodeId(
  runId: string,
  nodeId: string,
  data: {
    compactedOutput?: string | null
    error?: string | null
    finishedAt?: Date | null
    humanResponse?: string | null
    input?: Prisma.InputJsonValue | null
    rawOutput?: string | null
    startedAt?: Date | null
    status?: FlowRunStepStatus
  },
) {
  return prisma.flowRunStep.update({
    data: {
      compactedOutput: data.compactedOutput,
      error: data.error,
      finishedAt: data.finishedAt,
      humanResponse: data.humanResponse,
      input: data.input ?? undefined,
      rawOutput: data.rawOutput,
      startedAt: data.startedAt,
      status: data.status,
    },
    where: {
      runId_nodeId: { nodeId, runId },
    },
  })
}

export async function findRunByIdAndUserId(id: string, userId: string): Promise<FlowRunDetailRecord | null> {
  return prisma.flowRun.findFirst({
    include: {
      flow: true,
      steps: {
        orderBy: { createdAt: 'asc' },
      },
    },
    where: {
      flow: { userId },
      id,
    },
  })
}

export async function listRunsByFlowIdAndUserId(flowId: string, userId: string): Promise<FlowRunDetailRecord[]> {
  return prisma.flowRun.findMany({
    include: {
      flow: true,
      steps: {
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: 50,
    where: {
      flow: { userId },
      flowId,
    },
  })
}

export async function markRunResultSeenByIdAndUserId(id: string, userId: string, seenAt: Date): Promise<boolean> {
  const run = await prisma.flowRun.findFirst({
    select: {
      id: true,
      resultSeenAt: true,
      status: true,
    },
    where: {
      flow: { userId },
      id,
    },
  })

  if (!run) return false
  if (ACTIVE_RUN_STATUSES.includes(run.status) || run.resultSeenAt) return true

  const result = await prisma.flowRun.updateMany({
    data: { resultSeenAt: seenAt },
    where: {
      flow: { userId },
      id,
      resultSeenAt: null,
    },
  })

  return result.count === 1
}

export async function findSessionMetadataByUserId(userId: string, sessionIds: string[]): Promise<SessionMetadataRecord[]> {
  if (sessionIds.length === 0) return []

  const runs = await prisma.flowRun.findMany({
    select: {
      flow: {
        select: {
          id: true,
          name: true,
        },
      },
      id: true,
      openCodeSessionId: true,
      resultSeenAt: true,
      status: true,
      trigger: true,
    },
    where: {
      flow: { userId },
      openCodeSessionId: {
        in: sessionIds,
      },
    },
  })

  return runs.flatMap((run) => {
    if (!run.openCodeSessionId) return []

    return [{
      flowId: run.flow.id,
      flowName: run.flow.name,
      hasUnseenResult:
        !ACTIVE_RUN_STATUSES.includes(run.status) &&
        run.resultSeenAt === null,
      openCodeSessionId: run.openCodeSessionId,
      runId: run.id,
      status: run.status,
      trigger: run.trigger,
    }]
  })
}
