import { FlowRunStepStatus } from '@prisma/client'

import type { FlowNodeExecutorFailure, FlowNodeExecutorOk, FlowNodeExecutorParams } from '@/lib/flows/node-executor-types'
import { errorMessage, isFlowRunCancellation, nodeTypeToPrisma, replaceStep } from '@/lib/flows/node-executor-utils'
import { toPrismaJson } from '@/lib/flows/serializers'
import { runFlowPromptAndReadOutput } from '@/lib/flows/session-executor'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { FlowNode } from '@/lib/flows/types'
import { flowService } from '@/lib/services'

export async function executeCompactionNode(params: Omit<FlowNodeExecutorParams, 'node'> & {
  node: Extract<FlowNode, { type: 'compaction' }>
}): Promise<FlowNodeExecutorOk | FlowNodeExecutorFailure> {
  const context = buildFlowTemplateContext({
    flowName: params.flow.name,
    previousOutput: params.previousOutput,
    runId: params.run.id,
    steps: params.steps,
  })
  const rendered = renderFlowTemplate(params.node.promptTemplate, context)
  if (!rendered.ok) return { ok: false, error: rendered.error, steps: params.steps }

  let steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ prompt: rendered.value }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.running,
  }))

  let result: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
  try {
    result = await runFlowPromptAndReadOutput({
      client: params.client,
      flowId: params.flow.id,
      leaseOwner: params.leaseOwner,
      prompt: rendered.value,
      runId: params.run.id,
      sessionId: params.sessionId,
      slug: params.slug,
      userId: params.executionUserId,
    })
  } catch (error) {
    const message = errorMessage(error, 'flow_prompt_failed')
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: message,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: message, steps }
  }
  if (!result.ok) {
    if (result.type === 'termination_unconfirmed') {
      return { ok: false, terminationUnconfirmed: true, cause: result.cause, steps }
    }
    if (isFlowRunCancellation(result.error)) return { ok: false, error: result.error, steps }

    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: result.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: result.error, steps }
  }

  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    compactedOutput: result.output,
    finishedAt: new Date(),
    rawOutput: result.output,
    status: FlowRunStepStatus.succeeded,
  }))

  return { ok: true, previousOutput: result.output, steps }
}
