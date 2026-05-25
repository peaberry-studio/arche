import { FlowNodeType, FlowRunStatus, FlowRunStepStatus, FlowRunTrigger } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { serializeFlowDetail, serializeFlowListItem, serializeFlowRun, toPrismaJson } from '@/lib/flows/serializers'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'
import type { FlowDetailRecord, FlowListRecord, FlowRunDetailRecord } from '@/lib/services/flow'

const now = new Date('2026-05-12T10:00:00.000Z')

function createRun(): FlowRunDetailRecord {
  return {
    createdAt: now,
    currentNodeId: null,
    error: null,
    executionUser: null,
    executionUserId: null,
    finishedAt: now,
    flow: createFlow([]),
    flowId: 'flow-1',
    id: 'run-1',
    attempt: 2,
    lastRetryError: 'instance_unavailable',
    openCodeSessionId: 'session-1',
    retryScheduledFor: now,
    resultSeenAt: null,
    scheduledFor: now,
    sessionTitle: 'Flow | Test',
    startedAt: now,
    status: FlowRunStatus.succeeded,
    steps: [
      {
        compactedOutput: 'compact',
        createdAt: now,
        error: null,
        finishedAt: now,
        humanResponse: null,
        id: 'step-1',
        input: { prompt: 'Hello' },
        nodeId: 'agent-1',
        nodeName: 'Agent',
        nodeType: FlowNodeType.agent,
        rawOutput: 'raw',
        runId: 'run-1',
        startedAt: now,
        status: FlowRunStepStatus.succeeded,
        updatedAt: now,
      },
    ],
    trigger: FlowRunTrigger.manual,
    updatedAt: now,
  }
}

function createFlow(runs: FlowRunDetailRecord[]): FlowDetailRecord {
  return {
    createdAt: now,
    cronExpression: null,
    definition: createDefaultFlowDefinition(),
    description: null,
    deletedAt: null,
    enabled: false,
    id: 'flow-1',
    lastRunAt: now,
    leaseExpiresAt: null,
    leaseOwner: null,
    name: 'Flow',
    nextRunAt: null,
    organizationCanRun: false,
    runs,
    timezone: 'UTC',
    updatedAt: now,
    user: { slug: 'alice' },
    userId: 'user-1',
    visibility: 'private',
  }
}

describe('flow serializers', () => {
  it('serializes flow details and run steps', () => {
    const run = createRun()
    const detail = serializeFlowDetail(createFlow([run]))

    expect(detail.runs[0]).toMatchObject({
      id: 'run-1',
      attempt: 2,
      lastRetryError: 'instance_unavailable',
      openCodeSessionId: 'session-1',
      retryScheduledFor: '2026-05-12T10:00:00.000Z',
      status: 'succeeded',
      steps: [{ compactedOutput: 'compact', nodeId: 'agent-1' }],
    })
  })

  it('redacts runs that are not visible to the actor', () => {
    const ownerRun = createRun()
    const memberRun = {
      ...createRun(),
      executionUser: { slug: 'bob' },
      executionUserId: 'user-2',
      id: 'run-2',
    }
    const flow = createFlow([memberRun, ownerRun])

    const ownerDetail = serializeFlowDetail(flow, { id: 'user-1', role: 'USER' })
    const adminDetail = serializeFlowDetail(flow, { id: 'admin-1', role: 'ADMIN' })
    const ownerListItem = serializeFlowListItem(flow, { id: 'user-1', role: 'USER' })

    expect(ownerDetail.runs).toHaveLength(1)
    expect(ownerDetail.runs[0].id).toBe('run-1')
    expect(ownerListItem.latestRun?.id).toBe('run-1')
    expect(adminDetail.runs.map((run) => run.id)).toEqual(['run-2', 'run-1'])
  })

  it('falls back to an empty definition when stored JSON is invalid', () => {
    const flow: FlowListRecord = {
      ...createFlow([]),
      definition: { invalid: true },
      runs: [],
    }

    expect(serializeFlowListItem(flow).definition).toEqual({ edges: [], nodes: [], startNodeId: '', version: 1 })
  })

  it('serializes standalone runs and converts JSON to Prisma input JSON', () => {
    expect(serializeFlowRun(createRun()).id).toBe('run-1')
    expect(toPrismaJson({ nested: ['value'] })).toEqual({ nested: ['value'] })
  })
})
