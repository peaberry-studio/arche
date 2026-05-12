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
    finishedAt: now,
    flow: createFlow([]),
    flowId: 'flow-1',
    id: 'run-1',
    openCodeSessionId: 'session-1',
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
    enabled: false,
    id: 'flow-1',
    lastRunAt: now,
    leaseExpiresAt: null,
    leaseOwner: null,
    name: 'Flow',
    nextRunAt: null,
    runs,
    slackNotificationConfig: null,
    timezone: 'UTC',
    updatedAt: now,
    userId: 'user-1',
  }
}

describe('flow serializers', () => {
  it('serializes flow details and run steps', () => {
    const run = createRun()
    const detail = serializeFlowDetail(createFlow([run]))

    expect(detail.runs[0]).toMatchObject({
      id: 'run-1',
      openCodeSessionId: 'session-1',
      status: 'succeeded',
      steps: [{ compactedOutput: 'compact', nodeId: 'agent-1' }],
    })
  })

  it('falls back to an empty definition when stored JSON is invalid', () => {
    const flow: FlowListRecord = {
      ...createFlow([]),
      definition: { invalid: true },
      runs: [],
    }

    expect(serializeFlowListItem(flow).definition).toEqual({ edges: [], nodes: [], startNodeId: '', version: 1 })
  })

  it('serializes Slack notification config', () => {
    const detail = serializeFlowDetail({
      ...createFlow([]),
      slackNotificationConfig: {
        enabled: true,
        includeSessionLink: false,
        targets: [{ type: 'dm', userId: 'user-1' }],
      },
    })

    expect(detail.slackNotificationConfig).toEqual({
      enabled: true,
      includeSessionLink: false,
      targets: [{ type: 'dm', userId: 'user-1' }],
    })
  })

  it('serializes standalone runs and converts JSON to Prisma input JSON', () => {
    expect(serializeFlowRun(createRun()).id).toBe('run-1')
    expect(toPrismaJson({ nested: ['value'] })).toEqual({ nested: ['value'] })
  })
})
