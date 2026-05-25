import { Prisma } from '@prisma/client'

import type {
  FlowDetail,
  FlowListItem,
  FlowPermissions,
  FlowRunListItem,
  FlowRunStepListItem,
  FlowUserSummary,
} from '@/lib/flows/types'
import {
  canCopyFlow,
  canEditFlow,
  canManageFlow,
  canRunFlow,
  canViewFlow,
  canViewFlowRun,
} from '@/lib/flows/permissions'
import { validateFlowDefinition } from '@/lib/flows/validation'
import type {
  FlowDetailRecord,
  FlowListRecord,
  FlowRunDetailRecord,
  FlowRunRecord,
  FlowRunStepRecord,
  FlowUserRecord,
} from '@/lib/services/flow'

type FlowPermissionActor = {
  id: string
  role: string
}

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

function serializeUserSummary(user: FlowUserRecord | null | undefined): FlowUserSummary | null {
  return user ? { slug: user.slug } : null
}

function serializeRun(run: (FlowRunRecord & { steps: FlowRunStepRecord[] }) | FlowRunDetailRecord | null | undefined): FlowRunListItem | null {
  if (!run) return null

  return {
    currentNodeId: run.currentNodeId,
    attempt: run.attempt,
    error: run.error,
    executionUser: serializeUserSummary(run.executionUser),
    executionUserId: run.executionUserId ?? null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    flowId: run.flowId,
    id: run.id,
    lastRetryError: run.lastRetryError,
    openCodeSessionId: run.openCodeSessionId,
    retryScheduledFor: run.retryScheduledFor ? run.retryScheduledFor.toISOString() : null,
    scheduledFor: run.scheduledFor.toISOString(),
    sessionTitle: run.sessionTitle,
    startedAt: run.startedAt.toISOString(),
    status: run.status,
    steps: run.steps.map(serializeStep),
    trigger: run.trigger,
  }
}

function getPermissions(flow: FlowListRecord | FlowDetailRecord, actor?: FlowPermissionActor): FlowPermissions {
  const permissionActor = actor ?? { id: flow.userId, role: 'USER' }

  return {
    canCopy: canCopyFlow(permissionActor, flow),
    canEdit: canEditFlow(permissionActor, flow),
    canManage: canManageFlow(permissionActor, flow),
    canRun: canRunFlow(permissionActor, flow),
    canView: canViewFlow(permissionActor, flow),
    isOwner: permissionActor.id === flow.userId,
  }
}

function isRunVisibleToActor(
  flow: FlowListRecord | FlowDetailRecord,
  run: FlowRunRecord & { steps: FlowRunStepRecord[] },
  actor: FlowPermissionActor,
): boolean {
  return canViewFlowRun(actor, { executionUserId: run.executionUserId, flow })
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

export function serializeFlowListItem(flow: FlowListRecord, actor?: FlowPermissionActor): FlowListItem {
  const permissionActor = actor ?? { id: flow.userId, role: 'USER' }
  const latestRun = flow.runs.find((run) => isRunVisibleToActor(flow, run, permissionActor))

  return {
    createdAt: flow.createdAt.toISOString(),
    cronExpression: flow.cronExpression,
    definition: parseDefinition(flow.definition),
    description: flow.description,
    enabled: flow.enabled,
    id: flow.id,
    lastRunAt: flow.lastRunAt ? flow.lastRunAt.toISOString() : null,
    latestRun: serializeRun(latestRun),
    name: flow.name,
    nextRunAt: flow.nextRunAt ? flow.nextRunAt.toISOString() : null,
    organizationCanRun: flow.organizationCanRun,
    owner: serializeUserSummary(flow.user),
    permissions: getPermissions(flow, actor),
    timezone: flow.timezone,
    updatedAt: flow.updatedAt.toISOString(),
    visibility: flow.visibility,
  }
}

export function serializeFlowDetail(flow: FlowDetailRecord, actor?: FlowPermissionActor): FlowDetail {
  const permissionActor = actor ?? { id: flow.userId, role: 'USER' }

  return {
    ...serializeFlowListItem(flow, actor),
    runs: flow.runs
      .filter((run) => isRunVisibleToActor(flow, run, permissionActor))
      .map((run) => serializeRun(run))
      .filter((run): run is FlowRunListItem => run !== null),
  }
}

export function serializeFlowRun(run: FlowRunDetailRecord): FlowRunListItem {
  const serialized = serializeRun(run)
  if (!serialized) {
    throw new Error('flow_run_serialize_failed')
  }
  return serialized
}
