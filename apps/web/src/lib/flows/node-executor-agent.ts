import { FlowRunStepStatus } from '@prisma/client'

import { toPrismaJson } from '@/lib/flows/serializers'
import {
  runFlowPromptAndReadOutput,
} from '@/lib/flows/session-executor'
import { buildFlowTemplateContext, renderFlowTemplate } from '@/lib/flows/template'
import type { FlowNode } from '@/lib/flows/types'
import { flowService } from '@/lib/services'
import type { FlowNodeExecutorFailure, FlowNodeExecutorOk, FlowNodeExecutorParams } from '@/lib/flows/node-executor-types'
import { errorMessage, isFlowRunCancellation, nodeTypeToPrisma, replaceStep } from '@/lib/flows/node-executor-utils'

export async function executeAgentNode(params: Omit<FlowNodeExecutorParams, 'node'> & {
  node: Extract<FlowNode, { type: 'agent' }>
}): Promise<FlowNodeExecutorOk | FlowNodeExecutorFailure> {
  const context = buildFlowTemplateContext({
    flowName: params.flow.name,
    previousOutput: params.previousOutput,
    runId: params.run.id,
    steps: params.steps,
  })
  const rendered = renderFlowTemplate(params.node.promptTemplate, context)
  if (!rendered.ok) return { ok: false, status: 'failed', error: rendered.error, steps: params.steps }

  let steps = replaceStep(params.steps, await flowService.upsertRunStep({
    input: toPrismaJson({ prompt: rendered.value }),
    nodeId: params.node.id,
    nodeName: params.node.name,
    nodeType: nodeTypeToPrisma(params.node),
    runId: params.run.id,
    startedAt: new Date(),
    status: FlowRunStepStatus.running,
  }))

  let rawResult: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
  try {
    rawResult = await runFlowPromptAndReadOutput({
      agent: params.node.targetAgentId,
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
    return { ok: false, status: 'failed', error: message, steps }
  }
  if (!rawResult.ok) {
    if (rawResult.type === 'termination_unconfirmed') {
      return { ok: false, status: 'termination_unconfirmed', cause: rawResult.cause, steps }
    }
    if (isFlowRunCancellation(rawResult.error)) return { ok: false, status: 'failed', error: rawResult.error, steps }

    steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
      error: rawResult.error,
      finishedAt: new Date(),
      status: FlowRunStepStatus.failed,
    }))
    return { ok: false, status: 'failed', error: rawResult.error, steps }
  }

  let compactedOutput: string | null = null
  if (params.node.compactOutput) {
    const compactPrompt = [
      'Compact the previous assistant output for use by later flow steps.',
      'Keep the facts, decisions, links, and next actions. Return only the compacted output.',
      '',
      rawResult.output,
    ].join('\n')
    let compactResult: Awaited<ReturnType<typeof runFlowPromptAndReadOutput>>
    try {
      compactResult = await runFlowPromptAndReadOutput({
        client: params.client,
        flowId: params.flow.id,
        leaseOwner: params.leaseOwner,
        prompt: compactPrompt,
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
        rawOutput: rawResult.output,
        status: FlowRunStepStatus.failed,
      }))
      return { ok: false, status: 'failed', error: message, steps }
    }
    if (!compactResult.ok) {
      if (compactResult.type === 'termination_unconfirmed') {
        return { ok: false, status: 'termination_unconfirmed', cause: compactResult.cause, steps }
      }
      if (isFlowRunCancellation(compactResult.error)) return { ok: false, status: 'failed', error: compactResult.error, steps }

      steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
        error: compactResult.error,
        finishedAt: new Date(),
        rawOutput: rawResult.output,
        status: FlowRunStepStatus.failed,
      }))
      return { ok: false, status: 'failed', error: compactResult.error, steps }
    }

    compactedOutput = compactResult.output
  }

  const output = compactedOutput ?? rawResult.output
  steps = replaceStep(steps, await flowService.updateRunStepByRunIdAndNodeId(params.run.id, params.node.id, {
    compactedOutput,
    finishedAt: new Date(),
    rawOutput: rawResult.output,
    status: FlowRunStepStatus.succeeded,
  }))

  return { ok: true, previousOutput: output, steps }
}
