import { FlowNodeType, FlowRunStatus, FlowRunStepStatus, FlowRunTrigger } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  flow: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  flowRun: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  flowRunStep: {
    update: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import * as flowService from '@/lib/services/flow'

const now = new Date('2026-05-12T10:00:00.000Z')

function createFlowRecord(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: now,
    cronExpression: null,
    definition: { version: 1 },
    description: null,
    enabled: false,
    id: 'flow-1',
    lastRunAt: null,
    leaseExpiresAt: null,
    leaseOwner: null,
    name: 'Flow',
    nextRunAt: null,
    timezone: 'UTC',
    updatedAt: now,
    userId: 'user-1',
    ...overrides,
  }
}

function createRunRecord(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: now,
    currentNodeId: null,
    error: null,
    finishedAt: null,
    flowId: 'flow-1',
    id: 'run-1',
    openCodeSessionId: null,
    resultSeenAt: null,
    scheduledFor: now,
    sessionTitle: null,
    startedAt: now,
    status: FlowRunStatus.running,
    trigger: FlowRunTrigger.manual,
    updatedAt: now,
    ...overrides,
  }
}

describe('flowService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks stale running runs failed when their flow lease has expired', async () => {
    prismaMock.flowRun.updateMany.mockResolvedValue({ count: 2 })

    await expect(flowService.recoverStaleRunningRuns(now)).resolves.toBe(2)

    expect(prismaMock.flowRun.updateMany).toHaveBeenCalledWith({
      data: {
        currentNodeId: null,
        error: 'flow_run_stale_recovered',
        finishedAt: now,
        status: FlowRunStatus.failed,
      },
      where: {
        flow: {
          leaseExpiresAt: { lt: now },
        },
        status: FlowRunStatus.running,
      },
    })
  })

  it('recovers stale running runs before claiming an immediate run', async () => {
    const flow = createFlowRecord()
    prismaMock.flowRun.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.flow.findFirst.mockResolvedValue(flow)
    prismaMock.flow.updateMany.mockResolvedValue({ count: 1 })

    const result = await flowService.claimFlowForImmediateRun({
      id: 'flow-1',
      leaseMs: 900_000,
      leaseOwner: 'worker-1',
      now,
      userId: 'user-1',
    })

    expect(result).toMatchObject({
      id: 'flow-1',
      leaseOwner: 'worker-1',
      scheduledFor: now,
    })
    expect(prismaMock.flowRun.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.flow.findFirst.mock.invocationCallOrder[0],
    )
  })

  it('performs basic flow CRUD operations', async () => {
    const flow = createFlowRecord()
    prismaMock.flow.findMany.mockResolvedValue([flow])
    prismaMock.flow.findFirst.mockResolvedValue(flow)
    prismaMock.flow.create.mockResolvedValue(flow)
    prismaMock.flow.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.flow.deleteMany.mockResolvedValue({ count: 1 })

    await expect(flowService.listFlowsByUserId('user-1')).resolves.toEqual([flow])
    await expect(flowService.findFlowByIdAndUserId('flow-1', 'user-1')).resolves.toEqual(flow)
    await expect(flowService.createFlow({ definition: { version: 1 }, enabled: false, name: 'Flow', timezone: 'UTC', userId: 'user-1' })).resolves.toEqual(flow)
    await expect(flowService.updateFlowByIdAndUserId('flow-1', 'user-1', { name: 'Updated' })).resolves.toEqual(flow)
    await expect(flowService.deleteFlowByIdAndUserId('flow-1', 'user-1')).resolves.toEqual({ count: 1 })
  })

  it('claims scheduled and resume leases', async () => {
    const dueFlow = createFlowRecord({ nextRunAt: now })
    prismaMock.flowRun.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.flow.findFirst.mockResolvedValue(dueFlow)
    prismaMock.flow.updateMany.mockResolvedValue({ count: 1 })

    await expect(flowService.claimNextDueFlow({
      leaseMs: 900_000,
      leaseOwner: 'worker-1',
      now,
      resolveNextRunAt: () => new Date('2026-05-13T10:00:00.000Z'),
    })).resolves.toMatchObject({ id: 'flow-1', scheduledFor: now })

    await expect(flowService.claimFlowLeaseById({ id: 'flow-1', leaseMs: 900_000, leaseOwner: 'worker-2', now, userId: 'user-1' }))
      .resolves.toMatchObject({ id: 'flow-1', leaseOwner: 'worker-2' })
  })

  it('updates flow leases and run lifecycle state', async () => {
    const run = createRunRecord()
    prismaMock.flow.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.flowRun.create.mockResolvedValue(run)
    prismaMock.flowRun.update.mockResolvedValue(run)
    prismaMock.flowRun.updateMany.mockResolvedValue({ count: 1 })

    await flowService.extendFlowLease('flow-1', 'worker-1', now)
    await flowService.releaseFlowLease('flow-1', 'worker-1', now)
    await expect(flowService.createRun({ flowId: 'flow-1', scheduledFor: now, trigger: FlowRunTrigger.manual })).resolves.toEqual(run)
    await flowService.attachRunSession('run-1', { openCodeSessionId: 'session-1', sessionTitle: 'Title' })
    await flowService.updateRunCurrentNode('run-1', 'agent-1')
    await flowService.markRunWaitingForHuman('run-1', 'human-1')
    await flowService.markRunRunning('run-1')
    await flowService.markRunSucceeded('run-1', { finishedAt: now, openCodeSessionId: 'session-1', sessionTitle: 'Title' })
    await flowService.markRunFailed('run-1', { error: 'failed', finishedAt: now })
    await expect(flowService.cancelRunByIdAndUserId('run-1', 'user-1', now)).resolves.toBe(true)
  })

  it('upserts and updates run steps', async () => {
    const step = {
      compactedOutput: null,
      createdAt: now,
      error: null,
      finishedAt: null,
      humanResponse: null,
      id: 'step-1',
      input: null,
      nodeId: 'agent-1',
      nodeName: 'Agent',
      nodeType: FlowNodeType.agent,
      rawOutput: null,
      runId: 'run-1',
      startedAt: now,
      status: FlowRunStepStatus.running,
      updatedAt: now,
    }
    prismaMock.flowRunStep.upsert.mockResolvedValue(step)
    prismaMock.flowRunStep.update.mockResolvedValue({ ...step, status: FlowRunStepStatus.succeeded })

    await expect(flowService.upsertRunStep({ nodeId: 'agent-1', nodeName: 'Agent', nodeType: FlowNodeType.agent, runId: 'run-1', startedAt: now, status: FlowRunStepStatus.running }))
      .resolves.toEqual(step)
    await expect(flowService.updateRunStepByRunIdAndNodeId('run-1', 'agent-1', { finishedAt: now, status: FlowRunStepStatus.succeeded }))
      .resolves.toMatchObject({ status: FlowRunStepStatus.succeeded })
  })

  it('finds runs, marks results seen, and maps session metadata', async () => {
    const run = createRunRecord({ flow: createFlowRecord(), steps: [] })
    prismaMock.flowRun.findFirst
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ id: 'run-1', resultSeenAt: null, status: FlowRunStatus.succeeded })
    prismaMock.flowRun.findMany
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([{
        flow: { id: 'flow-1', name: 'Flow' },
        id: 'run-1',
        openCodeSessionId: 'session-1',
        resultSeenAt: null,
        status: FlowRunStatus.succeeded,
        trigger: FlowRunTrigger.manual,
      }])
    prismaMock.flowRun.updateMany.mockResolvedValue({ count: 1 })

    await expect(flowService.findRunByIdAndUserId('run-1', 'user-1')).resolves.toEqual(run)
    await expect(flowService.listRunsByFlowIdAndUserId('flow-1', 'user-1')).resolves.toEqual([run])
    await expect(flowService.markRunResultSeenByIdAndUserId('run-1', 'user-1', now)).resolves.toBe(true)
    await expect(flowService.findSessionMetadataByUserId('user-1', ['session-1'])).resolves.toEqual([{
      flowId: 'flow-1',
      flowName: 'Flow',
      hasUnseenResult: true,
      openCodeSessionId: 'session-1',
      runId: 'run-1',
      status: FlowRunStatus.succeeded,
      trigger: FlowRunTrigger.manual,
    }])
  })
})
