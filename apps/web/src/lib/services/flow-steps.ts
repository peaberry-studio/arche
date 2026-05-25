import {
  FlowNodeType,
  FlowRunStepStatus,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { FlowRunStepRecord } from '@/lib/services/flow-records'

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
