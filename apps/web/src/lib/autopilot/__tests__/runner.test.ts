import { beforeEach, describe, expect, it, vi } from 'vitest'

const getWorkspaceStatusMock = vi.fn()
const startWorkspaceMock = vi.fn()
const createInstanceClientMock = vi.fn()
const createRunMock = vi.fn()
const attachRunSessionMock = vi.fn()
const extendTaskLeaseMock = vi.fn()
const markRunSucceededMock = vi.fn()
const markRunFailedMock = vi.fn()
const releaseTaskLeaseMock = vi.fn()
const claimTaskForImmediateRunMock = vi.fn()
const findTaskByIdAndUserIdMock = vi.fn()
const touchActivityMock = vi.fn()
const findByIdSelectMock = vi.fn()
const createAuditEventMock = vi.fn()

vi.mock('@/lib/runtime/workspace-host', () => ({
  getWorkspaceStatus: (...args: unknown[]) => getWorkspaceStatusMock(...args),
  startWorkspace: (...args: unknown[]) => startWorkspaceMock(...args),
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: (...args: unknown[]) => createInstanceClientMock(...args),
}))

vi.mock('@/lib/services', () => ({
  auditService: {
    createEvent: (...args: unknown[]) => createAuditEventMock(...args),
  },
  autopilotService: {
    attachRunSession: (...args: unknown[]) => attachRunSessionMock(...args),
    claimTaskForImmediateRun: (...args: unknown[]) => claimTaskForImmediateRunMock(...args),
    createRun: (...args: unknown[]) => createRunMock(...args),
    extendTaskLease: (...args: unknown[]) => extendTaskLeaseMock(...args),
    findTaskByIdAndUserId: (...args: unknown[]) => findTaskByIdAndUserIdMock(...args),
    markRunFailed: (...args: unknown[]) => markRunFailedMock(...args),
    markRunSucceeded: (...args: unknown[]) => markRunSucceededMock(...args),
    releaseTaskLease: (...args: unknown[]) => releaseTaskLeaseMock(...args),
  },
  instanceService: {
    touchActivity: (...args: unknown[]) => touchActivityMock(...args),
  },
  userService: {
    findByIdSelect: (...args: unknown[]) => findByIdSelectMock(...args),
  },
}))

describe('autopilot runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getWorkspaceStatusMock.mockResolvedValue({ status: 'running' })
    startWorkspaceMock.mockResolvedValue({ ok: true, status: 'running' })
    findByIdSelectMock.mockResolvedValue({ slug: 'alice' })
    createRunMock.mockResolvedValue({ id: 'run-1' })
    attachRunSessionMock.mockResolvedValue(undefined)
    extendTaskLeaseMock.mockResolvedValue(undefined)
    findTaskByIdAndUserIdMock.mockResolvedValue({ id: 'task-1' })
    markRunSucceededMock.mockResolvedValue(undefined)
    markRunFailedMock.mockResolvedValue(undefined)
    releaseTaskLeaseMock.mockResolvedValue(undefined)
    touchActivityMock.mockResolvedValue(undefined)
    createAuditEventMock.mockResolvedValue(undefined)
  })

  it('marks a claimed task as succeeded when the session completes cleanly', async () => {
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({
          data: { id: 'session-1' },
        }),
        messages: vi.fn().mockResolvedValue({
          data: [
            {
              info: {
                role: 'assistant',
                time: { completed: 1 },
              },
              parts: [
                { id: 'part-1', type: 'text', text: 'Done' },
              ],
            },
          ],
        }),
        promptAsync: vi.fn().mockResolvedValue({ response: { ok: true } }),
        status: vi.fn().mockResolvedValue({
          data: {
            'session-1': { type: 'idle' },
          },
        }),
      },
    })

    const { runClaimedAutopilotTask } = await import('../runner')
    await runClaimedAutopilotTask(
      {
        id: 'task-1',
        userId: 'user-1',
        name: 'Daily summary',
        prompt: 'Summarize the day',
        targetAgentId: null,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
        nextRunAt: new Date('2026-04-13T09:00:00.000Z'),
        lastRunAt: null,
        leaseOwner: 'lease-1',
        leaseExpiresAt: new Date('2026-04-12T09:15:00.000Z'),
        createdAt: new Date('2026-04-12T08:00:00.000Z'),
        updatedAt: new Date('2026-04-12T08:00:00.000Z'),
        scheduledFor: new Date('2026-04-12T09:00:00.000Z'),
      },
      'schedule'
    )

    expect(createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', trigger: 'schedule' })
    )
    expect(attachRunSessionMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ openCodeSessionId: 'session-1' })
    )
    expect(markRunSucceededMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ openCodeSessionId: 'session-1' })
    )
    expect(releaseTaskLeaseMock).toHaveBeenCalledWith('task-1', 'lease-1', expect.any(Date))
  })

  it('returns task_busy when an immediate run cannot acquire the lease', async () => {
    claimTaskForImmediateRunMock.mockResolvedValue(null)
    findTaskByIdAndUserIdMock.mockResolvedValue({ id: 'task-1' })

    const { triggerAutopilotTaskNow } = await import('../runner')
    const result = await triggerAutopilotTaskNow({
      taskId: 'task-1',
      trigger: 'manual',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'task_busy' })
  })
})
