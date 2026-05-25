import { getFlowOutgoingTargets } from '@/lib/flows/graph'
import { executeAgentNode } from '@/lib/flows/node-executor-agent'
import { executeCompactionNode } from '@/lib/flows/node-executor-compaction'
import { executeConditionNode } from '@/lib/flows/node-executor-condition'
import { executeHumanNode } from '@/lib/flows/node-executor-human'
import { executeMergeNode } from '@/lib/flows/node-executor-merge'
import { executeSlackNode } from '@/lib/flows/node-executor-slack'
import type {
  FlowNodeExecutionResult,
  FlowNodeExecutorFailure,
  FlowNodeExecutorParams,
} from '@/lib/flows/node-executor-types'
import { isFlowRunCancellation } from '@/lib/flows/node-executor-utils'

export type { FlowNodeExecutionResult } from '@/lib/flows/node-executor-types'

function failureToExecutionResult(result: FlowNodeExecutorFailure): FlowNodeExecutionResult {
  return isFlowRunCancellation(result.error)
    ? { status: 'cancelled', steps: result.steps }
    : { status: 'failed', error: result.error, steps: result.steps }
}

function nextEdge(params: Pick<FlowNodeExecutorParams, 'definition' | 'node'>): string | null {
  return getFlowOutgoingTargets(params.definition, params.node.id)[0] ?? null
}

export async function executeFlowNode(params: FlowNodeExecutorParams): Promise<FlowNodeExecutionResult> {
  if (params.node.type === 'agent') {
    const result = await executeAgentNode({ ...params, node: params.node })
    if (!result.ok) return failureToExecutionResult(result)

    return {
      nextNodeId: nextEdge(params),
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  if (params.node.type === 'human') {
    return executeHumanNode({ ...params, node: params.node })
  }

  if (params.node.type === 'condition') {
    const result = await executeConditionNode({ ...params, node: params.node })
    if (!result.ok) return failureToExecutionResult(result)

    return {
      nextNodeId: result.nextNodeId ?? null,
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  if (params.node.type === 'slack') {
    const result = await executeSlackNode({
      flow: params.flow,
      node: params.node,
      previousOutput: params.previousOutput,
      run: params.run,
      steps: params.steps,
    })
    if (!result.ok) return failureToExecutionResult(result)

    return {
      nextNodeId: nextEdge(params),
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  if (params.node.type === 'compaction') {
    const result = await executeCompactionNode({ ...params, node: params.node })
    if (!result.ok) return failureToExecutionResult(result)

    return {
      nextNodeId: nextEdge(params),
      previousOutput: result.previousOutput,
      status: 'continue',
      steps: result.steps,
    }
  }

  const steps = await executeMergeNode({ node: params.node, run: params.run, steps: params.steps })
  return {
    nextNodeId: nextEdge(params),
    previousOutput: params.previousOutput,
    status: 'continue',
    steps,
  }
}
