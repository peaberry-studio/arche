import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createLearningRunRecord: vi.fn(),
  hasActiveLearningRun: vi.fn(),
  hasRecentLearningRun: vi.fn(),
  markLearningRunFailedRecord: vi.fn(),
  markLearningRunRunningRecord: vi.fn(),
  markLearningRunSucceededRecord: vi.fn(),
  setLearningRunMessageCount: vi.fn(),
}))

vi.mock('@/lib/learning/repository', () => ({
  createLearningRunRecord: mocks.createLearningRunRecord,
  hasActiveLearningRun: mocks.hasActiveLearningRun,
  hasRecentLearningRun: mocks.hasRecentLearningRun,
  markLearningRunFailed: mocks.markLearningRunFailedRecord,
  markLearningRunRunning: mocks.markLearningRunRunningRecord,
  markLearningRunSucceeded: mocks.markLearningRunSucceededRecord,
  setLearningRunMessageCount: mocks.setLearningRunMessageCount,
}))

const run = {
  id: 'run-1',
  sourceSessionId: 'session-1',
  internalSessionId: null,
  title: 'Source session',
  trigger: 'auto',
  status: 'pending',
  error: null,
  messageCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('learning run lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasActiveLearningRun.mockResolvedValue(false)
    mocks.hasRecentLearningRun.mockResolvedValue(false)
    mocks.createLearningRunRecord.mockResolvedValue(run)
  })

  it('creates a queued run record without an internal session', async () => {
    const { createLearningRun } = await import('@/lib/learning/run-lifecycle')

    await expect(createLearningRun({ userId: 'user-1', slug: 'alice', sourceSessionId: 'session-1', title: 'Source session', trigger: 'auto' })).resolves.toEqual({ ok: true, run })
    expect(mocks.createLearningRunRecord).toHaveBeenCalledWith(expect.objectContaining({
      internalSessionId: null,
      sourceSessionId: 'session-1',
    }))
  })

  it('skips auto-learning below the message threshold', async () => {
    const { maybeQueueAutoLearningRun } = await import('@/lib/learning/run-lifecycle')

    await maybeQueueAutoLearningRun({ userId: 'user-1', slug: 'alice', sessionId: 'session-1', sessionTitle: 'Source session', messageCount: 11 })

    expect(mocks.hasActiveLearningRun).not.toHaveBeenCalled()
    expect(mocks.createLearningRunRecord).not.toHaveBeenCalled()
  })

  it('skips auto-learning when active or inside cooldown', async () => {
    const { canQueueAutoLearningRun } = await import('@/lib/learning/run-lifecycle')
    mocks.hasActiveLearningRun.mockResolvedValueOnce(true)
    await expect(canQueueAutoLearningRun({ userId: 'user-1', sessionId: 'session-1' })).resolves.toBe(false)

    mocks.hasActiveLearningRun.mockResolvedValueOnce(false)
    mocks.hasRecentLearningRun.mockResolvedValueOnce(true)
    await expect(canQueueAutoLearningRun({ userId: 'user-1', sessionId: 'session-1' })).resolves.toBe(false)
  })

  it('treats only fresh pending runs as active', async () => {
    const { canQueueAutoLearningRun } = await import('@/lib/learning/run-lifecycle')
    const before = Date.now()

    await canQueueAutoLearningRun({ userId: 'user-1', sessionId: 'session-1' })

    const args = mocks.hasActiveLearningRun.mock.calls[0][0]
    expect(args.pendingSince).toBeInstanceOf(Date)
    const staleWindowMs = before - args.pendingSince.getTime()
    expect(staleWindowMs).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000 - 1000)
    expect(staleWindowMs).toBeLessThanOrEqual(6 * 60 * 60 * 1000 + 1000)
  })

  it('queues auto-learning and stores message count when eligible', async () => {
    const { maybeQueueAutoLearningRun } = await import('@/lib/learning/run-lifecycle')

    await maybeQueueAutoLearningRun({ userId: 'user-1', slug: 'alice', sessionId: 'session-1', sessionTitle: 'Source session', messageCount: 12 })

    expect(mocks.createLearningRunRecord).toHaveBeenCalled()
    expect(mocks.setLearningRunMessageCount).toHaveBeenCalledWith({ runId: 'run-1', messageCount: 12 })
  })

  it('forwards explicit run status updates', async () => {
    const { markLearningRunFailed, markLearningRunRunning, markLearningRunSucceeded } = await import('@/lib/learning/run-lifecycle')

    await markLearningRunRunning('run-1')
    await markLearningRunSucceeded('run-1')
    await markLearningRunFailed({ runId: 'run-1', error: 'failed' })

    expect(mocks.markLearningRunRunningRecord).toHaveBeenCalledWith('run-1')
    expect(mocks.markLearningRunSucceededRecord).toHaveBeenCalledWith('run-1')
    expect(mocks.markLearningRunFailedRecord).toHaveBeenCalledWith({ runId: 'run-1', error: 'failed' })
  })
})
