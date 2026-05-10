import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutopilotRunStatus, AutopilotRunTrigger } from '@prisma/client'

const mockPrisma = vi.hoisted(() => ({
  autopilotTask: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  autopilotRun: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

describe('autopilotService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // listTasksByUserId
  // -----------------------------------------------------------------------
  describe('listTasksByUserId', () => {
    it('queries tasks scoped to user with run include and ordering', async () => {
      mockPrisma.autopilotTask.findMany.mockResolvedValue([])
      const { listTasksByUserId } = await import('../autopilot')
      const result = await listTasksByUserId('user-1')

      expect(result).toEqual([])
      expect(mockPrisma.autopilotTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          include: expect.objectContaining({
            runs: expect.objectContaining({ take: 1 }),
          }),
          orderBy: [
            { enabled: 'desc' },
            { nextRunAt: 'asc' },
            { createdAt: 'asc' },
          ],
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // findTaskByIdAndUserId
  // -----------------------------------------------------------------------
  describe('findTaskByIdAndUserId', () => {
    it('returns task with detail include when found', async () => {
      const task = { id: 'task-1', userId: 'user-1', runs: [] }
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)

      const { findTaskByIdAndUserId } = await import('../autopilot')
      const result = await findTaskByIdAndUserId('task-1', 'user-1')

      expect(result).toEqual(task)
      expect(mockPrisma.autopilotTask.findFirst).toHaveBeenCalledWith({
        where: { id: 'task-1', userId: 'user-1' },
        include: expect.objectContaining({
          runs: expect.objectContaining({ take: 50 }),
        }),
      })
    })

    it('returns null when task not found', async () => {
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(null)

      const { findTaskByIdAndUserId } = await import('../autopilot')
      const result = await findTaskByIdAndUserId('missing', 'user-1')

      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // createTask
  // -----------------------------------------------------------------------
  describe('createTask', () => {
    it('creates a task with all fields', async () => {
      const nextRunAt = new Date('2026-04-20T08:00:00Z')
      const created = { id: 'task-new', userId: 'u1', name: 'Daily summary' }
      mockPrisma.autopilotTask.create.mockResolvedValue(created)

      const { createTask } = await import('../autopilot')
      const result = await createTask({
        userId: 'u1',
        name: 'Daily summary',
        prompt: 'Summarize',
        cronExpression: '0 8 * * *',
        timezone: 'UTC',
        enabled: true,
        nextRunAt,
      })

      expect(result).toEqual(created)
      expect(mockPrisma.autopilotTask.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          name: 'Daily summary',
          prompt: 'Summarize',
          targetAgentId: null,
          cronExpression: '0 8 * * *',
          timezone: 'UTC',
          enabled: true,
          nextRunAt,
        },
      })
    })

    it('passes targetAgentId when provided', async () => {
      mockPrisma.autopilotTask.create.mockResolvedValue({ id: 'task-new' })

      const { createTask } = await import('../autopilot')
      await createTask({
        userId: 'u1',
        name: 'Test',
        prompt: 'Test',
        targetAgentId: 'agent-1',
        cronExpression: '0 8 * * *',
        timezone: 'UTC',
        enabled: true,
        nextRunAt: new Date(),
      })

      expect(mockPrisma.autopilotTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ targetAgentId: 'agent-1' }),
      })
    })
  })

  // -----------------------------------------------------------------------
  // updateTaskByIdAndUserId
  // -----------------------------------------------------------------------
  describe('updateTaskByIdAndUserId', () => {
    it('returns updated task when update succeeds', async () => {
      const updated = { id: 'task-1', name: 'New Name' }
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(updated)

      const { updateTaskByIdAndUserId } = await import('../autopilot')
      const result = await updateTaskByIdAndUserId('task-1', 'user-1', { name: 'New Name' })

      expect(result).toEqual(updated)
      expect(mockPrisma.autopilotTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', userId: 'user-1' },
        data: { name: 'New Name' },
      })
      expect(mockPrisma.autopilotTask.findFirst).toHaveBeenCalledWith({
        where: { id: 'task-1', userId: 'user-1' },
      })
    })

    it('returns null when no rows updated (task not found or wrong user)', async () => {
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 0 })

      const { updateTaskByIdAndUserId } = await import('../autopilot')
      const result = await updateTaskByIdAndUserId('task-x', 'user-1', { name: 'X' })

      expect(result).toBeNull()
      expect(mockPrisma.autopilotTask.findFirst).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // deleteTaskByIdAndUserId
  // -----------------------------------------------------------------------
  describe('deleteTaskByIdAndUserId', () => {
    it('deletes tasks scoped to id and user', async () => {
      mockPrisma.autopilotTask.deleteMany.mockResolvedValue({ count: 1 })

      const { deleteTaskByIdAndUserId } = await import('../autopilot')
      await deleteTaskByIdAndUserId('task-1', 'user-1')

      expect(mockPrisma.autopilotTask.deleteMany).toHaveBeenCalledWith({
        where: { id: 'task-1', userId: 'user-1' },
      })
    })
  })

  // -----------------------------------------------------------------------
  // claimNextDueTask
  // -----------------------------------------------------------------------
  describe('claimNextDueTask', () => {
    const now = new Date('2026-04-20T10:00:00Z')
    const resolveNextRunAt = vi.fn(() => new Date('2026-04-21T10:00:00Z'))

    it('claims the first due task and returns it with scheduledFor', async () => {
      const task = {
        id: 'task-1',
        userId: 'u1',
        name: 'Test',
        enabled: true,
        nextRunAt: new Date('2026-04-20T09:00:00Z'),
        leaseOwner: null,
        leaseExpiresAt: null,
        retryAttempt: 0,
        retryScheduledFor: null,
      }
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { claimNextDueTask } = await import('../autopilot')
      const result = await claimNextDueTask({
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
        resolveNextRunAt,
      })

      expect(result).not.toBeNull()
      expect(result!.id).toBe('task-1')
      expect(result!.leaseOwner).toBe('worker-1')
      expect(result!.scheduledFor).toEqual(task.nextRunAt)
      expect(resolveNextRunAt).toHaveBeenCalledWith(task)
      expect(mockPrisma.autopilotTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              autopilotTasks: {
                none: {
                  leaseExpiresAt: { gt: now },
                },
              },
            },
          }),
        }),
      )
    })

    it('preserves the original scheduled slot when claiming a retry', async () => {
      const retryScheduledFor = new Date('2026-04-20T09:00:00Z')
      const task = {
        id: 'task-1',
        userId: 'u1',
        name: 'Test',
        enabled: true,
        nextRunAt: new Date('2026-04-20T09:02:00Z'),
        leaseOwner: null,
        leaseExpiresAt: null,
        retryAttempt: 1,
        retryScheduledFor,
      }
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { claimNextDueTask } = await import('../autopilot')
      const result = await claimNextDueTask({
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
        resolveNextRunAt,
      })

      expect(result!.scheduledFor).toEqual(retryScheduledFor)
    })

    it('returns null when no due tasks exist', async () => {
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(null)

      const { claimNextDueTask } = await import('../autopilot')
      const result = await claimNextDueTask({
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
        resolveNextRunAt,
      })

      expect(result).toBeNull()
    })

    it('retries up to 3 times on contention and returns null on all failures', async () => {
      const task = {
        id: 'task-1',
        nextRunAt: new Date('2026-04-20T09:00:00Z'),
        leaseOwner: null,
        leaseExpiresAt: null,
      }
      // findFirst always finds the task, but updateMany always fails (contention)
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 0 })

      const { claimNextDueTask } = await import('../autopilot')
      const result = await claimNextDueTask({
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
        resolveNextRunAt,
      })

      expect(result).toBeNull()
      expect(mockPrisma.autopilotTask.findFirst).toHaveBeenCalledTimes(3)
      expect(mockPrisma.autopilotTask.updateMany).toHaveBeenCalledTimes(3)
    })

    it('succeeds on second attempt after contention', async () => {
      const task = {
        id: 'task-1',
        nextRunAt: new Date('2026-04-20T09:00:00Z'),
        leaseOwner: null,
        leaseExpiresAt: null,
      }
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)
      mockPrisma.autopilotTask.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 })

      const { claimNextDueTask } = await import('../autopilot')
      const result = await claimNextDueTask({
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
        resolveNextRunAt,
      })

      expect(result).not.toBeNull()
      expect(result!.id).toBe('task-1')
      expect(mockPrisma.autopilotTask.findFirst).toHaveBeenCalledTimes(2)
    })
  })

  // -----------------------------------------------------------------------
  // claimTaskForImmediateRun
  // -----------------------------------------------------------------------
  describe('claimTaskForImmediateRun', () => {
    const now = new Date('2026-04-20T10:00:00Z')

    it('claims a specific task by id', async () => {
      const task = {
        id: 'task-1',
        leaseOwner: null,
        leaseExpiresAt: null,
        nextRunAt: new Date('2026-04-21T10:00:00Z'),
      }
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { claimTaskForImmediateRun } = await import('../autopilot')
      const result = await claimTaskForImmediateRun({
        id: 'task-1',
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
      })

      expect(result).not.toBeNull()
      expect(result!.id).toBe('task-1')
      expect(result!.leaseOwner).toBe('worker-1')
      expect(result!.scheduledFor).toEqual(now)
    })

    it('scopes query by userId when provided', async () => {
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(null)

      const { claimTaskForImmediateRun } = await import('../autopilot')
      await claimTaskForImmediateRun({
        id: 'task-1',
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
        userId: 'user-1',
      })

      expect(mockPrisma.autopilotTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      )
    })

    it('returns null when task not found', async () => {
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(null)

      const { claimTaskForImmediateRun } = await import('../autopilot')
      const result = await claimTaskForImmediateRun({
        id: 'task-1',
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
      })

      expect(result).toBeNull()
    })

    it('returns null when claim fails due to contention', async () => {
      const task = { id: 'task-1', leaseOwner: null, leaseExpiresAt: null }
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 0 })

      const { claimTaskForImmediateRun } = await import('../autopilot')
      const result = await claimTaskForImmediateRun({
        id: 'task-1',
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
      })

      expect(result).toBeNull()
    })

    it('does not include userId in where clause when userId is not provided', async () => {
      const task = { id: 'task-1', leaseOwner: null, leaseExpiresAt: null }
      mockPrisma.autopilotTask.findFirst.mockResolvedValue(task)
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { claimTaskForImmediateRun } = await import('../autopilot')
      await claimTaskForImmediateRun({
        id: 'task-1',
        leaseMs: 60_000,
        leaseOwner: 'worker-1',
        now,
      })

      const findCall = mockPrisma.autopilotTask.findFirst.mock.calls[0][0]
      expect(findCall.where).not.toHaveProperty('userId')
    })
  })

  // -----------------------------------------------------------------------
  // extendTaskLease
  // -----------------------------------------------------------------------
  describe('extendTaskLease', () => {
    it('updates lease expiry for the owned task', async () => {
      const newExpiry = new Date('2026-04-20T11:00:00Z')
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { extendTaskLease } = await import('../autopilot')
      await extendTaskLease('task-1', 'worker-1', newExpiry)

      expect(mockPrisma.autopilotTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', leaseOwner: 'worker-1' },
        data: { leaseExpiresAt: newExpiry },
      })
    })
  })

  // -----------------------------------------------------------------------
  // releaseTaskLease
  // -----------------------------------------------------------------------
  describe('releaseTaskLease', () => {
    it('clears lease and sets lastRunAt', async () => {
      const lastRunAt = new Date('2026-04-20T10:30:00Z')
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { releaseTaskLease } = await import('../autopilot')
      await releaseTaskLease('task-1', 'worker-1', lastRunAt)

      expect(mockPrisma.autopilotTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', leaseOwner: 'worker-1' },
        data: {
          lastRunAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
    })
  })

  // -----------------------------------------------------------------------
  // createRun
  // -----------------------------------------------------------------------
  describe('createRun', () => {
    it('creates a run with default running status', async () => {
      const scheduledFor = new Date('2026-04-20T08:00:00Z')
      const created = { id: 'run-1', status: 'running' }
      mockPrisma.autopilotRun.create.mockResolvedValue(created)

      const { createRun } = await import('../autopilot')
      const result = await createRun({
        taskId: 'task-1',
        trigger: AutopilotRunTrigger.schedule,
        scheduledFor,
      })

      expect(result).toEqual(created)
      expect(mockPrisma.autopilotRun.create).toHaveBeenCalledWith({
        data: {
          taskId: 'task-1',
          status: AutopilotRunStatus.running,
          trigger: AutopilotRunTrigger.schedule,
          scheduledFor,
          attempt: 1,
          startedAt: undefined,
        },
      })
    })

    it('accepts explicit status and startedAt', async () => {
      const scheduledFor = new Date('2026-04-20T08:00:00Z')
      const startedAt = new Date('2026-04-20T08:01:00Z')
      mockPrisma.autopilotRun.create.mockResolvedValue({ id: 'run-2' })

      const { createRun } = await import('../autopilot')
      await createRun({
        taskId: 'task-1',
        status: AutopilotRunStatus.succeeded,
        trigger: AutopilotRunTrigger.manual,
        scheduledFor,
        startedAt,
      })

      expect(mockPrisma.autopilotRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: AutopilotRunStatus.succeeded,
          startedAt,
        }),
      })
    })
  })

  describe('retry state', () => {
    it('schedules a retry while preserving the original scheduled slot', async () => {
      const retryAt = new Date('2026-04-20T10:02:00Z')
      const retryScheduledFor = new Date('2026-04-20T10:00:00Z')
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { scheduleTaskRetry } = await import('../autopilot')
      await scheduleTaskRetry({
        leaseOwner: 'worker-1',
        retryAttempt: 1,
        retryAt,
        retryScheduledFor,
        taskId: 'task-1',
      })

      expect(mockPrisma.autopilotTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', leaseOwner: 'worker-1' },
        data: {
          nextRunAt: retryAt,
          retryAttempt: 1,
          retryScheduledFor,
        },
      })
    })

    it('clears retry state for the owned task lease', async () => {
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })

      const { clearTaskRetryState } = await import('../autopilot')
      await clearTaskRetryState('task-1', 'worker-1')

      expect(mockPrisma.autopilotTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', leaseOwner: 'worker-1' },
        data: {
          retryAttempt: 0,
          retryScheduledFor: null,
        },
      })
    })
  })

  // -----------------------------------------------------------------------
  // markRunSucceeded
  // -----------------------------------------------------------------------
  describe('markRunSucceeded', () => {
    it('marks a run as succeeded with session data', async () => {
      const finishedAt = new Date('2026-04-20T10:30:00Z')
      mockPrisma.autopilotRun.update.mockResolvedValue({ id: 'run-1', status: 'succeeded' })

      const { markRunSucceeded } = await import('../autopilot')
      await markRunSucceeded('run-1', {
        finishedAt,
        openCodeSessionId: 'session-1',
        sessionTitle: 'My Session',
      })

      expect(mockPrisma.autopilotRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: {
          status: AutopilotRunStatus.succeeded,
          finishedAt,
          openCodeSessionId: 'session-1',
          sessionTitle: 'My Session',
        },
      })
    })

    it('defaults session fields to null when not provided', async () => {
      const finishedAt = new Date('2026-04-20T10:30:00Z')
      mockPrisma.autopilotRun.update.mockResolvedValue({ id: 'run-1' })

      const { markRunSucceeded } = await import('../autopilot')
      await markRunSucceeded('run-1', { finishedAt })

      expect(mockPrisma.autopilotRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          openCodeSessionId: null,
          sessionTitle: null,
        }),
      })
    })
  })

  // -----------------------------------------------------------------------
  // markRunFailed
  // -----------------------------------------------------------------------
  describe('markRunFailed', () => {
    it('marks a run as failed with error and session data', async () => {
      const finishedAt = new Date('2026-04-20T10:30:00Z')
      mockPrisma.autopilotRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' })

      const { markRunFailed } = await import('../autopilot')
      await markRunFailed('run-1', {
        error: 'timeout',
        finishedAt,
        openCodeSessionId: 'session-1',
        sessionTitle: 'My Session',
      })

      expect(mockPrisma.autopilotRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: {
          status: AutopilotRunStatus.failed,
          error: 'timeout',
          finishedAt,
          openCodeSessionId: 'session-1',
          sessionTitle: 'My Session',
        },
      })
    })

    it('defaults session fields to null when not provided', async () => {
      const finishedAt = new Date('2026-04-20T10:30:00Z')
      mockPrisma.autopilotRun.update.mockResolvedValue({ id: 'run-1' })

      const { markRunFailed } = await import('../autopilot')
      await markRunFailed('run-1', { error: 'err', finishedAt })

      expect(mockPrisma.autopilotRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          openCodeSessionId: null,
          sessionTitle: null,
        }),
      })
    })
  })

  // -----------------------------------------------------------------------
  // attachRunSession
  // -----------------------------------------------------------------------
  describe('attachRunSession', () => {
    it('updates run with session data', async () => {
      mockPrisma.autopilotRun.update.mockResolvedValue({ id: 'run-1' })

      const { attachRunSession } = await import('../autopilot')
      await attachRunSession('run-1', {
        openCodeSessionId: 'session-1',
        sessionTitle: 'Session Title',
      })

      expect(mockPrisma.autopilotRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: {
          openCodeSessionId: 'session-1',
          sessionTitle: 'Session Title',
        },
      })
    })
  })

  // -----------------------------------------------------------------------
  // markRunResultSeenByIdAndUserId
  // -----------------------------------------------------------------------
  describe('markRunResultSeenByIdAndUserId', () => {
    const seenAt = new Date('2026-04-20T12:00:00Z')

    it('marks unseen completed run as seen and returns true', async () => {
      mockPrisma.autopilotRun.findFirst.mockResolvedValue({
        id: 'run-1',
        status: AutopilotRunStatus.succeeded,
        resultSeenAt: null,
      })
      mockPrisma.autopilotRun.updateMany.mockResolvedValue({ count: 1 })

      const { markRunResultSeenByIdAndUserId } = await import('../autopilot')
      const result = await markRunResultSeenByIdAndUserId('run-1', 'user-1', seenAt)

      expect(result).toBe(true)
      expect(mockPrisma.autopilotRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-1', resultSeenAt: null },
        data: { resultSeenAt: seenAt },
      })
    })

    it('returns false when run not found', async () => {
      mockPrisma.autopilotRun.findFirst.mockResolvedValue(null)

      const { markRunResultSeenByIdAndUserId } = await import('../autopilot')
      const result = await markRunResultSeenByIdAndUserId('run-x', 'user-1', seenAt)

      expect(result).toBe(false)
      expect(mockPrisma.autopilotRun.updateMany).not.toHaveBeenCalled()
    })

    it('returns true without updating when run is still running', async () => {
      mockPrisma.autopilotRun.findFirst.mockResolvedValue({
        id: 'run-1',
        status: AutopilotRunStatus.running,
        resultSeenAt: null,
      })

      const { markRunResultSeenByIdAndUserId } = await import('../autopilot')
      const result = await markRunResultSeenByIdAndUserId('run-1', 'user-1', seenAt)

      expect(result).toBe(true)
      expect(mockPrisma.autopilotRun.updateMany).not.toHaveBeenCalled()
    })

    it('returns true without updating when result was already seen', async () => {
      mockPrisma.autopilotRun.findFirst.mockResolvedValue({
        id: 'run-1',
        status: AutopilotRunStatus.succeeded,
        resultSeenAt: new Date('2026-04-19T12:00:00Z'),
      })

      const { markRunResultSeenByIdAndUserId } = await import('../autopilot')
      const result = await markRunResultSeenByIdAndUserId('run-1', 'user-1', seenAt)

      expect(result).toBe(true)
      expect(mockPrisma.autopilotRun.updateMany).not.toHaveBeenCalled()
    })

    it('returns false when concurrent update prevents marking (count 0)', async () => {
      mockPrisma.autopilotRun.findFirst.mockResolvedValue({
        id: 'run-1',
        status: AutopilotRunStatus.failed,
        resultSeenAt: null,
      })
      mockPrisma.autopilotRun.updateMany.mockResolvedValue({ count: 0 })

      const { markRunResultSeenByIdAndUserId } = await import('../autopilot')
      const result = await markRunResultSeenByIdAndUserId('run-1', 'user-1', seenAt)

      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // findSessionMetadataByUserId
  // -----------------------------------------------------------------------
  describe('findSessionMetadataByUserId', () => {
    it('returns empty array for empty sessionIds', async () => {
      const { findSessionMetadataByUserId } = await import('../autopilot')
      const result = await findSessionMetadataByUserId('user-1', [])

      expect(result).toEqual([])
      expect(mockPrisma.autopilotRun.findMany).not.toHaveBeenCalled()
    })

    it('maps runs to session metadata records', async () => {
      mockPrisma.autopilotRun.findMany.mockResolvedValue([
        {
          id: 'run-1',
          trigger: AutopilotRunTrigger.schedule,
          openCodeSessionId: 'oc-session-1',
          resultSeenAt: null,
          status: AutopilotRunStatus.succeeded,
          task: { id: 'task-1', name: 'Daily report' },
        },
      ])

      const { findSessionMetadataByUserId } = await import('../autopilot')
      const result = await findSessionMetadataByUserId('user-1', ['oc-session-1'])

      expect(result).toEqual([
        {
          openCodeSessionId: 'oc-session-1',
          trigger: AutopilotRunTrigger.schedule,
          taskId: 'task-1',
          taskName: 'Daily report',
          runId: 'run-1',
          hasUnseenResult: true,
        },
      ])
    })

    it('filters out runs without openCodeSessionId', async () => {
      mockPrisma.autopilotRun.findMany.mockResolvedValue([
        {
          id: 'run-1',
          trigger: AutopilotRunTrigger.schedule,
          openCodeSessionId: null,
          resultSeenAt: null,
          status: AutopilotRunStatus.succeeded,
          task: { id: 'task-1', name: 'Test' },
        },
      ])

      const { findSessionMetadataByUserId } = await import('../autopilot')
      const result = await findSessionMetadataByUserId('user-1', ['oc-session-1'])

      expect(result).toEqual([])
    })

    it('sets hasUnseenResult to false when run is still running', async () => {
      mockPrisma.autopilotRun.findMany.mockResolvedValue([
        {
          id: 'run-1',
          trigger: AutopilotRunTrigger.manual,
          openCodeSessionId: 'oc-session-1',
          resultSeenAt: null,
          status: AutopilotRunStatus.running,
          task: { id: 'task-1', name: 'Test' },
        },
      ])

      const { findSessionMetadataByUserId } = await import('../autopilot')
      const result = await findSessionMetadataByUserId('user-1', ['oc-session-1'])

      expect(result[0].hasUnseenResult).toBe(false)
    })

    it('sets hasUnseenResult to false when result has been seen', async () => {
      mockPrisma.autopilotRun.findMany.mockResolvedValue([
        {
          id: 'run-1',
          trigger: AutopilotRunTrigger.schedule,
          openCodeSessionId: 'oc-session-1',
          resultSeenAt: new Date('2026-04-20T10:00:00Z'),
          status: AutopilotRunStatus.succeeded,
          task: { id: 'task-1', name: 'Test' },
        },
      ])

      const { findSessionMetadataByUserId } = await import('../autopilot')
      const result = await findSessionMetadataByUserId('user-1', ['oc-session-1'])

      expect(result[0].hasUnseenResult).toBe(false)
    })
  })
})
