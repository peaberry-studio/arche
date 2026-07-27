import type { FlowDefinition, FlowNode } from '@/lib/flows/types'
import type { SessionExecutionClient } from '@/lib/opencode/session-execution'
import type { FlowRecord, FlowRunRecord, FlowRunStepRecord } from '@/lib/services/flow'

export type FlowNodeExecutionResult =
  | { status: 'cancelled'; steps: FlowRunStepRecord[] }
  | { status: 'continue'; nextNodeId: string | null; previousOutput: string | null; steps: FlowRunStepRecord[] }
  | { status: 'failed'; error: string; steps: FlowRunStepRecord[] }
  | { status: 'termination_unconfirmed'; cause: string; steps: FlowRunStepRecord[] }
  | { status: 'waiting_for_human'; nodeId: string; steps: FlowRunStepRecord[] }

export type FlowNodeExecutorParams = {
  client: SessionExecutionClient
  definition: FlowDefinition
  executionUserId: string
  flow: FlowRecord
  leaseOwner: string
  node: FlowNode
  previousOutput: string | null
  run: FlowRunRecord
  sessionId: string
  slug: string
  steps: FlowRunStepRecord[]
}

export type FlowNodeExecutorOk = {
  ok: true
  nextNodeId?: string | null
  previousOutput: string | null
  steps: FlowRunStepRecord[]
}

export type FlowNodeExecutorFailure =
  | {
    ok: false
    error: string
    steps: FlowRunStepRecord[]
  }
  | {
    ok: false
    terminationUnconfirmed: true
    cause: string
    steps: FlowRunStepRecord[]
  }
