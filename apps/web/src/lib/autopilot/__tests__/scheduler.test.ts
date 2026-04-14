import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const claimNextDueTaskMock = vi.fn()
const runClaimedAutopilotTaskMock = vi.fn()

vi.mock('@/lib/services', () => ({
  autopilotService: {
    claimNextDueTask: (...args: unknown[]) => claimNextDueTaskMock(...args),
  },
}))

vi.mock('@/lib/autopilot/runner', () => ({
  AUTOPILOT_TASK_LEASE_MS: 900000,
  runClaimedAutopilotTask: (...args: unknown[]) => runClaimedAutopilotTaskMock(...args),
}))

describe('autopilot scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    runClaimedAutopilotTaskMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('dispatches due tasks and launches background runs', async () => {
    claimNextDueTaskMock
      .mockResolvedValueOnce({
        id: 'task-1',
        userId: 'user-1',
        name: 'Daily summary',
        prompt: 'Summarize',
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
      })
      .mockResolvedValueOnce(null)

    const { dispatchDueAutopilotTasks } = await import('../scheduler')
    const count = await dispatchDueAutopilotTasks()

    expect(count).toBe(1)
    expect(claimNextDueTaskMock).toHaveBeenCalledTimes(2)
    expect(runClaimedAutopilotTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1' }),
      'schedule'
    )
  })

  it('starts only one scheduler interval and performs an immediate dispatch', async () => {
    claimNextDueTaskMock.mockResolvedValue(null)

    const { startAutopilotScheduler, stopAutopilotScheduler, AUTOPILOT_SCHEDULER_INTERVAL_MS } = await import('../scheduler')

    startAutopilotScheduler()
    startAutopilotScheduler()
    await vi.waitFor(() => {
      expect(claimNextDueTaskMock).toHaveBeenCalledTimes(1)
    })

    await vi.advanceTimersByTimeAsync(AUTOPILOT_SCHEDULER_INTERVAL_MS)
    expect(claimNextDueTaskMock).toHaveBeenCalledTimes(2)

    stopAutopilotScheduler()
    await vi.advanceTimersByTimeAsync(AUTOPILOT_SCHEDULER_INTERVAL_MS)
    expect(claimNextDueTaskMock).toHaveBeenCalledTimes(2)
  })
})
