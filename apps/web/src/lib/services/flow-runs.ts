import {
  FlowRunStatus,
  FlowRunTrigger,
} from '@prisma/client'

import {
  createFlowActorScope,
  runExecutesInWorkspaceWhere,
  runVisibleToWorkspaceWhere,
  type FlowActorScope,
} from '@/lib/flows/authorization'
import { prisma } from '@/lib/prisma'
import {
  ACTIVE_RUN_STATUSES,
  FLOW_USER_SELECT,
  type FlowRunDetailRecord,
  type FlowRunRecord,
  type FlowRunStepRecord,
  type SessionMetadataRecord,
} from '@/lib/services/flow-records'

export function createRun(data: {
  attempt?: number
  executionUserId?: string | null
  flowId: string
  scheduledFor: Date
  status?: FlowRunStatus
  trigger: FlowRunTrigger
}): Promise<FlowRunRecord> {
  return prisma.flowRun.create({
    data: {
      attempt: data.attempt ?? 1,
      executionUserId: data.executionUserId ?? null,
      flowId: data.flowId,
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

export async function cancelRunByIdForScope(id: string, scope: FlowActorScope, cancelledAt: Date): Promise<boolean> {
  const result = await prisma.flowRun.updateMany({
    data: {
      finishedAt: cancelledAt,
      status: FlowRunStatus.cancelled,
    },
    where: {
      id,
      ...runExecutesInWorkspaceWhere(scope),
      status: { in: ACTIVE_RUN_STATUSES },
    },
  })

  return result.count === 1
}

export async function cancelRunById(id: string, cancelledAt: Date): Promise<boolean> {
  const result = await prisma.flowRun.updateMany({
    data: {
      finishedAt: cancelledAt,
      status: FlowRunStatus.cancelled,
    },
    where: {
      id,
      status: { in: ACTIVE_RUN_STATUSES },
    },
  })

  return result.count === 1
}

function runDetailInclude() {
  return {
    executionUser: {
      select: FLOW_USER_SELECT,
    },
    flow: {
      include: {
        user: {
          select: FLOW_USER_SELECT,
        },
      },
    },
    steps: {
      orderBy: { createdAt: 'asc' as const },
    },
  }
}

export async function findRunByIdForScope(id: string, scope: FlowActorScope): Promise<FlowRunDetailRecord | null> {
  return prisma.flowRun.findFirst({
    include: runDetailInclude(),
    where: {
      id,
      ...runVisibleToWorkspaceWhere(scope),
    },
  })
}

export async function listRunsByFlowIdForScope(flowId: string, scope: FlowActorScope): Promise<FlowRunDetailRecord[]> {
  return prisma.flowRun.findMany({
    include: runDetailInclude(),
    orderBy: { startedAt: 'desc' },
    take: 50,
    where: {
      flowId,
      ...runVisibleToWorkspaceWhere(scope),
    },
  })
}

export async function markRunResultSeenByIdForScope(id: string, scope: FlowActorScope, seenAt: Date): Promise<boolean> {
  const run = await prisma.flowRun.findFirst({
    select: {
      id: true,
      resultSeenAt: true,
      status: true,
    },
    where: {
      id,
      ...runExecutesInWorkspaceWhere(scope),
    },
  })

  if (!run) return false
  if (ACTIVE_RUN_STATUSES.includes(run.status) || run.resultSeenAt) return true

  const result = await prisma.flowRun.updateMany({
    data: { resultSeenAt: seenAt },
    where: {
      id,
      resultSeenAt: null,
      ...runExecutesInWorkspaceWhere(scope),
    },
  })

  return result.count === 1
}

export async function findSessionMetadataForWorkspace(workspaceUserId: string, sessionIds: string[]): Promise<SessionMetadataRecord[]> {
  if (sessionIds.length === 0) return []

  const scope = createFlowActorScope({ id: workspaceUserId, role: 'USER' }, workspaceUserId)
  const runs = await prisma.flowRun.findMany({
    select: {
      flow: {
        select: {
          id: true,
          name: true,
        },
      },
      executionUserId: true,
      id: true,
      openCodeSessionId: true,
      resultSeenAt: true,
      status: true,
      trigger: true,
    },
    where: {
      ...runExecutesInWorkspaceWhere(scope),
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

export function getLatestStepOutput(step: FlowRunStepRecord): string | null {
  return step.compactedOutput ?? step.rawOutput ?? step.humanResponse
}
