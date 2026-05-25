import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimNextDueFlow: vi.fn(),
  claimNextRetryRun: vi.fn(),
  createFlowLeaseOwner: vi.fn(),
  dispatchClaimedFlowRetryRun: vi.fn(),
  dispatchClaimedFlowRun: vi.fn(),
  getNextFlowRunAt: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  flowService: {
    claimNextDueFlow: mocks.claimNextDueFlow,
    claimNextRetryRun: mocks.claimNextRetryRun,
  },
}))

vi.mock('@/lib/flows/runner', () => ({
  FLOW_LEASE_MS: 900_000,
  dispatchClaimedFlowRetryRun: mocks.dispatchClaimedFlowRetryRun,
  dispatchClaimedFlowRun: mocks.dispatchClaimedFlowRun,
}))

vi.mock('@/lib/flows/session-executor', () => ({
  createFlowLeaseOwner: mocks.createFlowLeaseOwner,
}))

vi.mock('@/lib/flows/cron', () => ({
  getNextFlowRunAt: mocks.getNextFlowRunAt,
}))

import { dispatchDueFlows, getFlowSchedulerMode, getFlowSchedulerStatus, startFlowScheduler, stopFlowScheduler } from '@/lib/flows/scheduler'

function createClaimedFlow(id: string) {
  const now = new Date('2026-05-12T10:00:00.000Z')
  return {
    createdAt: now,
    cronExpression: '0 9 * * 1',
    definition: { version: 1 },
    deletedAt: null,
    description: null,
    enabled: true,
    id,
    lastRunAt: null,
    leaseExpiresAt: new Date('2026-05-12T10:15:00.000Z'),
    leaseOwner: `lease-${id}`,
    name: `Flow ${id}`,
    nextRunAt: new Date('2026-05-19T09:00:00.000Z'),
    scheduledFor: now,
    timezone: 'UTC',
    updatedAt: now,
    userId: 'user-1',
  }
}

describe('flow scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    stopFlowScheduler()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('requires an explicit scheduler mode in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ARCHE_FLOW_SCHEDULER_MODE', '')

    expect(() => getFlowSchedulerMode()).toThrow('ARCHE_FLOW_SCHEDULER_MODE is required in production')
  })

  it('resolves explicit and fallback scheduler modes', () => {
    vi.stubEnv('ARCHE_FLOW_SCHEDULER_MODE', 'off')
    expect(getFlowSchedulerMode()).toBe('off')

    vi.stubEnv('ARCHE_FLOW_SCHEDULER_MODE', 'invalid')
    expect(getFlowSchedulerMode()).toBe('inline')
  })

  it('claims and dispatches due flows up to the batch limit', async () => {
    const firstFlow = createClaimedFlow('flow-1')
    const secondFlow = createClaimedFlow('flow-2')
    mocks.createFlowLeaseOwner.mockResolvedValue('worker-1')
    mocks.claimNextDueFlow
      .mockResolvedValueOnce(firstFlow)
      .mockResolvedValueOnce(secondFlow)
      .mockResolvedValueOnce(null)
    mocks.claimNextRetryRun.mockResolvedValue(null)
    mocks.dispatchClaimedFlowRun.mockResolvedValue({ ok: true, runId: 'run-1' })
    mocks.getNextFlowRunAt.mockReturnValue(new Date('2026-05-19T09:00:00.000Z'))

    await expect(dispatchDueFlows(4)).resolves.toBe(2)

    expect(mocks.claimNextRetryRun).toHaveBeenCalledTimes(3)
    expect(mocks.claimNextDueFlow).toHaveBeenCalledTimes(3)
    expect(mocks.claimNextDueFlow).toHaveBeenNthCalledWith(1, expect.objectContaining({
      leaseMs: 900_000,
      leaseOwner: 'worker-1',
    }))
    expect(mocks.dispatchClaimedFlowRun).toHaveBeenCalledWith(firstFlow, 'schedule')
    expect(mocks.dispatchClaimedFlowRun).toHaveBeenCalledWith(secondFlow, 'schedule')
  })

  it('records scheduled dispatch failures before rethrowing', async () => {
    const flow = createClaimedFlow('flow-1')
    mocks.createFlowLeaseOwner.mockResolvedValue('worker-1')
    mocks.claimNextRetryRun.mockResolvedValue(null)
    mocks.claimNextDueFlow.mockResolvedValueOnce(flow)
    mocks.dispatchClaimedFlowRun.mockRejectedValue(new Error('dispatch failed'))

    await expect(dispatchDueFlows(1)).rejects.toThrow('dispatch failed')

    expect(getFlowSchedulerStatus().lastDispatchError).toBe('dispatch failed')
  })

  it('records dispatch errors before rethrowing', async () => {
    mocks.createFlowLeaseOwner.mockRejectedValue(new Error('claim failed'))

    await expect(dispatchDueFlows(1)).rejects.toThrow('claim failed')

    expect(getFlowSchedulerStatus().lastDispatchError).toBe('claim failed')
  })

  it('starts and stops the interval scheduler', () => {
    vi.useFakeTimers()
    mocks.createFlowLeaseOwner.mockResolvedValue('worker-1')
    mocks.claimNextRetryRun.mockResolvedValue(null)
    mocks.claimNextDueFlow.mockResolvedValue(null)

    startFlowScheduler()
    expect(getFlowSchedulerStatus().running).toBe(true)

    startFlowScheduler()
    stopFlowScheduler()
    expect(getFlowSchedulerStatus().running).toBe(false)
  })

  it('dispatches due retry runs before newly due schedules', async () => {
    const retry = {
      ...createClaimedFlow('flow-1'),
      retryRun: {
        attempt: 2,
        createdAt: new Date('2026-05-12T10:00:00.000Z'),
        currentNodeId: null,
        error: null,
        finishedAt: null,
        flow: createClaimedFlow('flow-1'),
        flowId: 'flow-1',
        id: 'run-1',
        lastRetryError: 'instance_unavailable',
        openCodeSessionId: null,
        resultSeenAt: null,
        retryScheduledFor: null,
        scheduledFor: new Date('2026-05-12T10:00:00.000Z'),
        sessionTitle: null,
        startedAt: new Date('2026-05-12T10:00:00.000Z'),
        status: 'running',
        steps: [],
        trigger: 'manual',
        updatedAt: new Date('2026-05-12T10:00:00.000Z'),
      },
    }
    mocks.createFlowLeaseOwner.mockResolvedValue('worker-1')
    mocks.claimNextRetryRun.mockResolvedValueOnce(retry).mockResolvedValueOnce(null)
    mocks.claimNextDueFlow.mockResolvedValue(null)
    mocks.dispatchClaimedFlowRetryRun.mockResolvedValue({ ok: true, runId: 'run-1' })

    await expect(dispatchDueFlows(2)).resolves.toBe(1)

    expect(mocks.dispatchClaimedFlowRetryRun).toHaveBeenCalledWith(retry)
    expect(mocks.dispatchClaimedFlowRun).not.toHaveBeenCalled()
  })
})
