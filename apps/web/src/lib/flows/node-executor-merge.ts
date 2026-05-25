import { FlowRunStepStatus } from '@prisma/client'

import { nodeTypeToPrisma, replaceStep } from '@/lib/flows/node-executor-utils'
import type { FlowNode } from '@/lib/flows/types'
import { flowService } from '@/lib/services'
import type { FlowRunRecord, FlowRunStepRecord } from '@/lib/services/flow'

export async function executeMergeNode(params: {
  node: Extract<FlowNode, { type: 'merge' }>
  run: FlowRunRecord
  steps: FlowRunStepRecord[]
}): Promise<FlowRunStepRecord[]> {
  return replaceStep(params.steps, await flowService.upsertRunStep({
    finishedAt: new Date(),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.succeeded,
  }))
}
