import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    messageRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    messageRunLock: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  createActiveRunAfterRuntimeStateCheck,
  MESSAGE_RUN_TIMEOUT_MS,
  reapStaleRuns,
} from '../message-run'

describe('messageRunService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears an idle runtime lock before retrying active run creation', async () => {
    const existingRun = {
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status: 'running',
      error: null,
      startedAt: new Date('2026-05-13T12:00:00.000Z'),
      finishedAt: null,
    }
    const createdRun = {
      ...existingRun,
      id: 'run-2',
      startedAt: new Date('2026-05-13T12:05:00.000Z'),
    }
    const readRuntimeSessionState = vi.fn().mockResolvedValue('idle')

    mockPrisma.messageRunLock.findUnique.mockResolvedValue({ run: existingRun })
    mockPrisma.messageRun.updateMany.mockReturnValue({ count: 1 })
    mockPrisma.messageRunLock.deleteMany.mockReturnValue({ count: 1 })
    mockPrisma.$transaction
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce([{ count: 1 }, { count: 1 }])
      .mockImplementationOnce(async (callback: (tx: {
        messageRun: { create: (args: unknown) => Promise<typeof createdRun> }
        messageRunLock: { create: (args: unknown) => Promise<unknown> }
      }) => Promise<typeof createdRun>) => callback({
        messageRun: { create: vi.fn().mockResolvedValue(createdRun) },
        messageRunLock: { create: vi.fn().mockResolvedValue({}) },
      }))

    const result = await createActiveRunAfterRuntimeStateCheck({
      readRuntimeSessionState,
      sessionId: 's1',
      slug: 'alice',
      source: 'web',
    })

    expect(result).toMatchObject({ ok: true, run: { id: 'run-2' } })
    expect(readRuntimeSessionState).toHaveBeenCalledTimes(1)
    expect(mockPrisma.messageRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'running' },
      data: {
        status: 'succeeded',
        error: null,
        finishedAt: expect.any(Date),
      },
    })
  })

  it('keeps a busy runtime lock active', async () => {
    const existingRun = {
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status: 'running',
      error: null,
      startedAt: new Date('2026-05-13T12:00:00.000Z'),
      finishedAt: null,
    }
    const readRuntimeSessionState = vi.fn().mockResolvedValue('busy')

    mockPrisma.messageRunLock.findUnique.mockResolvedValue({ run: existingRun })
    mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' })

    const result = await createActiveRunAfterRuntimeStateCheck({
      readRuntimeSessionState,
      sessionId: 's1',
      slug: 'alice',
      source: 'web',
    })

    expect(result).toMatchObject({ ok: false, error: 'session_busy', activeRun: { id: 'run-1' } })
    expect(mockPrisma.messageRun.updateMany).not.toHaveBeenCalled()
  })

  it('fails stale locked runs by startedAt TTL', async () => {
    const now = new Date('2026-05-13T13:00:00.000Z')
    const threshold = new Date(now.getTime() - MESSAGE_RUN_TIMEOUT_MS)

    mockPrisma.messageRunLock.findMany.mockResolvedValue([
      { runId: 'run-1' },
      { runId: 'run-2' },
    ])
    mockPrisma.messageRun.updateMany.mockReturnValue({ count: 2 })
    mockPrisma.messageRunLock.deleteMany.mockReturnValue({ count: 2 })
    mockPrisma.$transaction.mockResolvedValue([{ count: 2 }, { count: 2 }])

    await expect(reapStaleRuns(now)).resolves.toBe(2)
    expect(mockPrisma.messageRunLock.findMany).toHaveBeenCalledWith({
      where: {
        run: {
          is: {
            startedAt: { lte: threshold },
            status: 'running',
          },
        },
      },
      select: { runId: true },
    })
    expect(mockPrisma.messageRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['run-1', 'run-2'] },
        status: 'running',
      },
      data: {
        error: 'message_run_timeout',
        finishedAt: now,
        status: 'failed',
      },
    })
    expect(mockPrisma.messageRunLock.deleteMany).toHaveBeenCalledWith({
      where: { runId: { in: ['run-1', 'run-2'] } },
    })
  })
})
