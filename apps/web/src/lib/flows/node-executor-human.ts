import { FlowRunStepStatus } from '@prisma/client'

import type { FlowNodeExecutionResult, FlowNodeExecutorParams } from '@/lib/flows/node-executor-types'
import { nodeTypeToPrisma, replaceStep } from '@/lib/flows/node-executor-utils'
import { toPrismaJson } from '@/lib/flows/serializers'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { FlowNode } from '@/lib/flows/types'
import { flowService } from '@/lib/services'

export async function executeHumanNode(params: Omit<FlowNodeExecutorParams, 'node'> & {
  node: Extract<FlowNode, { type: 'human' }>
}): Promise<FlowNodeExecutionResult> {
  const context = buildFlowTemplateContext({
    flowName: params.flow.name,
    previousOutput: params.previousOutput,
    runId: params.run.id,
    steps: params.steps,
  })
  const rendered = renderFlowTemplate(params.node.instructions, context)
  if (!rendered.ok) return { error: rendered.error, status: 'failed', steps: params.steps }

  const steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ instructions: rendered.value, required: params.node.required }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.waiting_for_human,
  }))
  await flowService.markRunWaitingForHuman(params.run.id, params.node.id)
  return { nodeId: params.node.id, status: 'waiting_for_human', steps }
}
