import {
  FlowNodeType,
  FlowRunStatus,
  FlowRunStepStatus,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { ACTIVE_RUN_STATUSES, type FlowRunStepRecord } from '@/lib/services/flow-records'

async function writeActiveRunStep(
  runId: string,
  write: (transaction: Prisma.TransactionClient) => Promise<FlowRunStepRecord>,
): Promise<FlowRunStepRecord> {
  return prisma.$transaction(async (transaction) => {
    const result = await transaction.flowRun.updateMany({
      data: { updatedAt: new Date() },
      where: { id: runId, status: { in: ACTIVE_RUN_STATUSES } },
    })
    if (result.count !== 1) {
      const run = await transaction.flowRun.findUnique({
        select: { error: true, status: true },
        where: { id: runId },
      })
      throw new Error(run?.status === FlowRunStatus.cancelled ? 'flow_run_cancelled' : run?.error ?? 'flow_run_not_active')
    }

    return write(transaction)
  })
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
  return writeActiveRunStep(data.runId, (transaction) => transaction.flowRunStep.upsert({
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
  }))
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
  return writeActiveRunStep(runId, (transaction) => transaction.flowRunStep.update({
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
  }))
}
