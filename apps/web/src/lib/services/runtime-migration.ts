import { FlowRunStatus, FlowRunStepStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { ACTIVE_RUN_STATUSES } from '@/lib/services/flow-records'

export async function settleRuntimeMigratedRuns(slug: string): Promise<void> {
  const finishedAt = new Date()

  await prisma.$transaction(async (transaction) => {
    const messageRuns = await transaction.messageRun.findMany({
      select: { id: true },
      where: { slug, status: 'running' },
    })
    const messageRunIds = messageRuns.map((run) => run.id)

    await transaction.messageRun.updateMany({
      data: { error: 'runtime_migrated', finishedAt, status: 'failed' },
      where: { id: { in: messageRunIds }, slug, status: 'running' },
    })
    await transaction.messageRunLock.deleteMany({
      where: { runId: { in: messageRunIds }, slug },
    })

    const workspaceScope = {
      openCodeSessionId: { not: null },
      OR: [
        { executionUser: { slug } },
        { executionUserId: null, flow: { user: { slug } } },
      ],
    }
    const flowRuns = await transaction.flowRun.findMany({
      select: {
        flow: { select: { id: true, leaseOwner: true } },
        id: true,
      },
      where: { ...workspaceScope, status: { in: ACTIVE_RUN_STATUSES } },
    })

    for (const run of flowRuns) {
      const result = await transaction.flowRun.updateMany({
        data: {
          currentNodeId: null,
          error: 'runtime_migrated',
          finishedAt,
          lastRetryError: 'runtime_migrated',
          retryScheduledFor: null,
          status: FlowRunStatus.failed,
        },
        where: { ...workspaceScope, id: run.id, status: { in: ACTIVE_RUN_STATUSES } },
      })
      if (result.count !== 1) continue

      await transaction.flowRunStep.updateMany({
        data: { error: 'runtime_migrated', finishedAt, status: FlowRunStepStatus.failed },
        where: {
          runId: run.id,
          status: { in: [FlowRunStepStatus.pending, FlowRunStepStatus.running, FlowRunStepStatus.waiting_for_human] },
        },
      })
      await transaction.flow.updateMany({
        data: { leaseExpiresAt: null, leaseOwner: null },
        where: {
          id: run.flow.id,
          leaseOwner: run.flow.leaseOwner,
          runs: { none: { status: { in: ACTIVE_RUN_STATUSES } } },
        },
      })
    }
  })
}
