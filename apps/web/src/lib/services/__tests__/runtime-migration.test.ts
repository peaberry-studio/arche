import { beforeEach, describe, expect, it, vi } from 'vitest'

import { settleRuntimeMigratedRuns } from '@/lib/services/runtime-migration'

const { transaction, transact } = vi.hoisted(() => ({
  transaction: {
    messageRun: { findMany: vi.fn(), updateMany: vi.fn() },
    messageRunLock: { deleteMany: vi.fn() },
    flowRun: { findMany: vi.fn(), updateMany: vi.fn() },
    flowRunStep: { updateMany: vi.fn() },
    flow: { updateMany: vi.fn() },
  },
  transact: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: transact } }))

const workspaceScope = {
  openCodeSessionId: { not: null },
  OR: [
    { executionUser: { slug: 'alice' } },
    { executionUserId: null, flow: { user: { slug: 'alice' } } },
  ],
}
const activeStatuses = ['running', 'waiting_for_human']
const flow = { id: 'flow-1', leaseOwner: 'worker-1' }

describe('settleRuntimeMigratedRuns', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    transact.mockImplementation(async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction))
    transaction.messageRun.findMany.mockResolvedValue([{ id: 'message-1' }])
    transaction.messageRun.updateMany.mockResolvedValue({ count: 1 })
    transaction.messageRunLock.deleteMany.mockResolvedValue({ count: 1 })
    transaction.flowRun.findMany.mockResolvedValue([{ id: 'run-1', flow }])
    transaction.flowRun.updateMany.mockResolvedValue({ count: 1 })
    transaction.flowRunStep.updateMany.mockResolvedValue({ count: 3 })
    transaction.flow.updateMany.mockResolvedValue({ count: 1 })
  })

  it('settles only running messages and their locks in the migrating workspace transaction', async () => {
    await settleRuntimeMigratedRuns('alice')

    expect(transact).toHaveBeenCalledTimes(1)
    expect(transaction.messageRun.findMany).toHaveBeenCalledWith({ select: { id: true }, where: { slug: 'alice', status: 'running' } })
    expect(transaction.messageRun.updateMany).toHaveBeenCalledWith({
      data: { error: 'runtime_migrated', finishedAt: expect.any(Date), status: 'failed' },
      where: { id: { in: ['message-1'] }, slug: 'alice', status: 'running' },
    })
    expect(transaction.messageRunLock.deleteMany).toHaveBeenCalledWith({ where: { runId: { in: ['message-1'] }, slug: 'alice' } })
  })

  it('fails session-bound active flow runs, retries and unfinished steps without losing session metadata', async () => {
    await settleRuntimeMigratedRuns('alice')

    expect(transaction.flowRun.findMany).toHaveBeenCalledWith({
      select: { id: true, flow: { select: { id: true, leaseOwner: true } } },
      where: { ...workspaceScope, status: { in: activeStatuses } },
    })
    expect(transaction.flowRun.updateMany).toHaveBeenCalledWith({
      data: {
        currentNodeId: null, error: 'runtime_migrated', finishedAt: expect.any(Date),
        lastRetryError: 'runtime_migrated', retryScheduledFor: null, status: 'failed',
      },
      where: { ...workspaceScope, id: 'run-1', status: { in: activeStatuses } },
    })
    const finishedAt = transaction.flowRun.updateMany.mock.calls[0][0].data.finishedAt
    expect(transaction.flowRunStep.updateMany).toHaveBeenCalledWith({
      data: { error: 'runtime_migrated', finishedAt, status: 'failed' },
      where: { runId: 'run-1', status: { in: ['pending', 'running', 'waiting_for_human'] } },
    })
    expect(transaction.messageRun.updateMany.mock.calls[0][0].data.finishedAt).toBe(finishedAt)
    expect(transaction.flow.updateMany).toHaveBeenCalledWith({
      data: { leaseExpiresAt: null, leaseOwner: null },
      where: { id: 'flow-1', leaseOwner: 'worker-1', runs: { none: { status: { in: activeStatuses } } } },
    })
  })

  it('does not settle steps or release leases when another worker already finished the run', async () => {
    transaction.flowRun.updateMany.mockResolvedValue({ count: 0 })

    await settleRuntimeMigratedRuns('alice')

    expect(transaction.flowRunStep.updateMany).not.toHaveBeenCalled()
    expect(transaction.flow.updateMany).not.toHaveBeenCalled()
  })

  it('is safe to repeat when there are no active runs', async () => {
    transaction.messageRun.findMany.mockResolvedValue([])
    transaction.flowRun.findMany.mockResolvedValue([])

    await settleRuntimeMigratedRuns('alice')
    await settleRuntimeMigratedRuns('alice')

    expect(transaction.messageRunLock.deleteMany).toHaveBeenCalledWith({ where: { runId: { in: [] }, slug: 'alice' } })
    expect(transaction.flowRun.updateMany).not.toHaveBeenCalled()
    expect(transaction.flowRunStep.updateMany).not.toHaveBeenCalled()
    expect(transaction.flow.updateMany).not.toHaveBeenCalled()
  })

  it('settles active messages even when there are no session-bound flows', async () => {
    transaction.flowRun.findMany.mockResolvedValue([])

    await settleRuntimeMigratedRuns('alice')

    expect(transaction.messageRun.updateMany).toHaveBeenCalledWith({
      data: { error: 'runtime_migrated', finishedAt: expect.any(Date), status: 'failed' },
      where: { id: { in: ['message-1'] }, slug: 'alice', status: 'running' },
    })
    expect(transaction.messageRunLock.deleteMany).toHaveBeenCalledWith({ where: { runId: { in: ['message-1'] }, slug: 'alice' } })
    expect(transaction.flowRun.updateMany).not.toHaveBeenCalled()
    expect(transaction.flowRunStep.updateMany).not.toHaveBeenCalled()
    expect(transaction.flow.updateMany).not.toHaveBeenCalled()
  })

  it('propagates settlement failures from the transaction so callers cannot publish the switch', async () => {
    transaction.flowRunStep.updateMany.mockRejectedValue(new Error('database_unavailable'))

    await expect(settleRuntimeMigratedRuns('alice')).rejects.toThrow('database_unavailable')

    expect(transaction.flow.updateMany).not.toHaveBeenCalled()
  })
})
