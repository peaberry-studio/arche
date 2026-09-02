import { FlowNodeType as PrismaFlowNodeType } from '@prisma/client'

import {
  FLOW_RUN_CANCELLED_ERROR,
} from '@/lib/flows/session-executor'
import type { FlowNode, ForkFlowNode } from '@/lib/flows/types'
import type { FlowRunStepRecord } from '@/lib/services/flow'

// Fork nodes never record run steps (they are handled by the runner loop),
// so the step-record node mapping excludes them.
export type StepRecordFlowNode = Exclude<FlowNode, ForkFlowNode>

export function nodeTypeToPrisma(node: StepRecordFlowNode): PrismaFlowNodeType {
  switch (node.type) {
    case 'agent':
      return PrismaFlowNodeType.agent
    case 'human':
      return PrismaFlowNodeType.human
    case 'condition':
      return PrismaFlowNodeType.condition
    case 'slack':
      return PrismaFlowNodeType.slack
    case 'merge':
      return PrismaFlowNodeType.merge
    case 'compaction':
      return PrismaFlowNodeType.compaction
  }
}

export function replaceStep(steps: FlowRunStepRecord[], step: FlowRunStepRecord): FlowRunStepRecord[] {
  const existingIndex = steps.findIndex((candidate) => candidate.nodeId === step.nodeId)
  if (existingIndex === -1) return [...steps, step]

  const next = [...steps]
  next[existingIndex] = step
  return next
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function isFlowRunCancellation(error: string): boolean {
  return error === FLOW_RUN_CANCELLED_ERROR
}
