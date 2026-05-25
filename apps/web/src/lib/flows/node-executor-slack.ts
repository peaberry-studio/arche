import { FlowRunStepStatus } from '@prisma/client'

import type { FlowNodeExecutorFailure, FlowNodeExecutorOk, FlowNodeExecutorParams } from '@/lib/flows/node-executor-types'
import { errorMessage, nodeTypeToPrisma, replaceStep } from '@/lib/flows/node-executor-utils'
import { toPrismaJson } from '@/lib/flows/serializers'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { FlowNode, SlackFlowNode } from '@/lib/flows/types'
import { flowService } from '@/lib/services'
import { sendSlackNotifications } from '@/lib/slack/notifications'

export async function executeSlackNode(params: Pick<FlowNodeExecutorParams, 'flow' | 'previousOutput' | 'run' | 'steps'> & {
  node: SlackFlowNode
}): Promise<FlowNodeExecutorOk | FlowNodeExecutorFailure> {
  let text: string
  if (params.node.messageMode === 'previous_output') {
    if (!params.previousOutput?.trim()) {
      return { ok: false, error: 'slack_message_previous_output_missing', steps: params.steps }
    }
    text = params.previousOutput
  } else if (params.node.messageMode === 'template') {
    const rendered = renderFlowTemplate(params.node.messageTemplate, buildFlowTemplateContext({
      flowName: params.flow.name,
      previousOutput: params.previousOutput,
      runId: params.run.id,
      steps: params.steps,
    }))
    if (!rendered.ok) return { ok: false, error: rendered.error, steps: params.steps }
    text = rendered.value
  } else {
    text = params.node.messageTemplate
  }

  let steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ messageMode: params.node.messageMode, target: params.node.target, text }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.running,
  }))

  let result: Awaited<ReturnType<typeof sendSlackNotifications>>
  try {
    result = await sendSlackNotifications({
      source: 'flows',
      targets: [params.node.target],
      text,
    })
  } catch (error) {
    const message = errorMessage(error, 'slack_notification_failed')
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: message,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: message, steps }
  }

  if (!result.ok) {
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: result.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: result.error, steps }
  }

  if (result.failed > 0) {
    const detail = result.errors[0]?.error ?? 'slack_notification_failed'
    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: detail,
      finishedAt: new Date(),
      rawOutput: text,
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, error: detail, steps }
  }

  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    finishedAt: new Date(),
    rawOutput: text,
    status: FlowRunStepStatus.succeeded,
  }))

  return { ok: true, previousOutput: params.previousOutput, steps }
}

export type SlackNodeForExecutor = Extract<FlowNode, { type: 'slack' }>
