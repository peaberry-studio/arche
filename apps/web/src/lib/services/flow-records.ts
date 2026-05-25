import {
  FlowNodeType,
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTrigger,
  FlowVisibility,
} from '@prisma/client'

export type FlowRecord = {
  id: string
  userId: string
  user?: FlowUserRecord
  name: string
  description: string | null
  definition: unknown
  cronExpression: string | null
  timezone: string
  enabled: boolean
  visibility: FlowVisibility
  organizationCanRun: boolean
  nextRunAt: Date | null
  lastRunAt: Date | null
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export type FlowUserRecord = {
  email: string
  slug: string
}

export type FlowRunStepRecord = {
  id: string
  runId: string
  nodeId: string
  nodeName: string | null
  nodeType: FlowNodeType
  status: FlowRunStepStatus
  input: unknown
  rawOutput: string | null
  compactedOutput: string | null
  humanResponse: string | null
  error: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type FlowRunRecord = {
  id: string
  flowId: string
  executionUserId: string | null
  executionUser?: FlowUserRecord | null
  status: FlowRunStatus
  trigger: FlowRunTrigger
  scheduledFor: Date
  startedAt: Date
  finishedAt: Date | null
  error: string | null
  openCodeSessionId: string | null
  sessionTitle: string | null
  currentNodeId: string | null
  resultSeenAt: Date | null
  attempt: number
  retryScheduledFor: Date | null
  lastRetryError: string | null
  createdAt: Date
  updatedAt: Date
}

export type FlowListRecord = FlowRecord & {
  runs: Array<FlowRunRecord & { steps: FlowRunStepRecord[] }>
}

export type FlowDetailRecord = FlowRecord & {
  runs: Array<FlowRunRecord & { steps: FlowRunStepRecord[] }>
}

export type FlowRunDetailRecord = FlowRunRecord & {
  flow: FlowRecord
  steps: FlowRunStepRecord[]
}

export type FlowClaimedRecord = FlowRecord & {
  scheduledFor: Date
}

export type FlowRetryClaimedRecord = FlowRecord & {
  retryRun: FlowRunDetailRecord
  scheduledFor: Date
}

export type LeaseScope =
  | { leaseExpiresAt: null }
  | { leaseExpiresAt: { lt: Date } }

export type SessionMetadataRecord = {
  openCodeSessionId: string
  trigger: FlowRunTrigger
  flowId: string
  flowName: string
  runId: string
  status: FlowRunStatus
  hasUnseenResult: boolean
}

export const ACTIVE_RUN_STATUSES: FlowRunStatus[] = [
  FlowRunStatus.running,
  FlowRunStatus.waiting_for_human,
]

export const FLOW_USER_SELECT = {
  email: true,
  slug: true,
}

export function availableLease(now: Date): LeaseScope[] {
  return [
    { leaseExpiresAt: null },
    { leaseExpiresAt: { lt: now } },
  ]
}

export function noActiveRun() {
  return {
    runs: {
      none: {
        status: {
          in: ACTIVE_RUN_STATUSES,
        },
      },
    },
  }
}

export function normalizeOrganizationCanRun(visibility: FlowVisibility, organizationCanRun: boolean | undefined): boolean | undefined {
  if (visibility !== FlowVisibility.team) return false
  return organizationCanRun
}
