import { Prisma } from '@prisma/client'

import type {
  FlowDetail,
  FlowListItem,
  FlowRunListItem,
  FlowRunStepListItem,
  FlowSlackNotificationConfig,
  FlowSlackNotificationTarget,
} from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { isRecord } from '@/lib/records'
import type {
  FlowDetailRecord,
  FlowListRecord,
  FlowRunDetailRecord,
  FlowRunRecord,
  FlowRunStepRecord,
} from '@/lib/services/flow'

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function serializeStep(step: FlowRunStepRecord): FlowRunStepListItem {
  return {
    compactedOutput: step.compactedOutput,
    createdAt: step.createdAt.toISOString(),
    error: step.error,
    finishedAt: step.finishedAt ? step.finishedAt.toISOString() : null,
    humanResponse: step.humanResponse,
    id: step.id,
    input: step.input,
    nodeId: step.nodeId,
    nodeName: step.nodeName,
    nodeType: step.nodeType,
    rawOutput: step.rawOutput,
    startedAt: step.startedAt ? step.startedAt.toISOString() : null,
    status: step.status,
    updatedAt: step.updatedAt.toISOString(),
  }
}

function serializeRun(run: (FlowRunRecord & { steps: FlowRunStepRecord[] }) | FlowRunDetailRecord | null | undefined): FlowRunListItem | null {
  if (!run) return null

  return {
    currentNodeId: run.currentNodeId,
    error: run.error,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    flowId: run.flowId,
    id: run.id,
    openCodeSessionId: run.openCodeSessionId,
    scheduledFor: run.scheduledFor.toISOString(),
    sessionTitle: run.sessionTitle,
    startedAt: run.startedAt.toISOString(),
    status: run.status,
    steps: run.steps.map(serializeStep),
    trigger: run.trigger,
  }
}

function parseDefinition(definition: unknown) {
  const result = validateFlowDefinition(definition)
  if (result.ok) return result.definition
  return {
    edges: [],
    nodes: [],
    startNodeId: '',
    version: 1 as const,
  }
}

export function serializeSlackNotificationConfig(
  value: unknown,
): FlowSlackNotificationConfig | undefined {
  if (!isRecord(value)) return undefined

  const targetsRaw = Array.isArray(value.targets) ? value.targets : []
  const targets = targetsRaw.flatMap((targetRaw): FlowSlackNotificationTarget[] => {
    if (!isRecord(targetRaw)) return []

    if (targetRaw.type === 'dm' && typeof targetRaw.userId === 'string' && targetRaw.userId) {
      return [{ type: 'dm', userId: targetRaw.userId }]
    }

    if (targetRaw.type === 'channel' && typeof targetRaw.channelId === 'string' && targetRaw.channelId) {
      return [{ type: 'channel', channelId: targetRaw.channelId }]
    }

    return []
  })

  return {
    enabled: value.enabled === true,
    includeSessionLink: typeof value.includeSessionLink === 'boolean' ? value.includeSessionLink : true,
    targets,
  }
}

export function serializeFlowListItem(flow: FlowListRecord): FlowListItem {
  const slackNotificationConfig = serializeSlackNotificationConfig(flow.slackNotificationConfig)

  return {
    createdAt: flow.createdAt.toISOString(),
    cronExpression: flow.cronExpression,
    definition: parseDefinition(flow.definition),
    description: flow.description,
    enabled: flow.enabled,
    id: flow.id,
    lastRunAt: flow.lastRunAt ? flow.lastRunAt.toISOString() : null,
    latestRun: serializeRun(flow.runs[0]),
    name: flow.name,
    nextRunAt: flow.nextRunAt ? flow.nextRunAt.toISOString() : null,
    ...(slackNotificationConfig ? { slackNotificationConfig } : {}),
    timezone: flow.timezone,
    updatedAt: flow.updatedAt.toISOString(),
  }
}

export function serializeFlowDetail(flow: FlowDetailRecord): FlowDetail {
  return {
    ...serializeFlowListItem(flow),
    runs: flow.runs.map((run) => serializeRun(run)).filter((run): run is FlowRunListItem => run !== null),
  }
}

export function serializeFlowRun(run: FlowRunDetailRecord): FlowRunListItem {
  const serialized = serializeRun(run)
  if (!serialized) {
    throw new Error('flow_run_serialize_failed')
  }
  return serialized
}
