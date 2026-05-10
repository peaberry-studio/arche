import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const claimNextDueTaskMock = vi.fn()
const runClaimedAutopilotTaskMock = vi.fn()
const originalNodeEnv = process.env.NODE_ENV
const originalSchedulerMode = process.env.ARCHE_AUTOPILOT_SCHEDULER_MODE

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
    vi.resetModules()
    vi.useFakeTimers()
    vi.clearAllMocks()
    runClaimedAutopilotTaskMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalSchedulerMode === undefined) {
      delete process.env.ARCHE_AUTOPILOT_SCHEDULER_MODE
    } else {
      process.env.ARCHE_AUTOPILOT_SCHEDULER_MODE = originalSchedulerMode
    }
    process.env.NODE_ENV = originalNodeEnv
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

  it('logs background run failures without failing dispatch', async () => {
    const error = new Error('run failed')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
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
    runClaimedAutopilotTaskMock.mockRejectedValueOnce(error)

    try {
      const { dispatchDueAutopilotTasks } = await import('../scheduler')

      await expect(dispatchDueAutopilotTasks()).resolves.toBe(1)
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
        '[autopilot] Failed to execute scheduled task run',
        { taskId: 'task-1', error },
      ))
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('records dispatch errors before rethrowing them', async () => {
    claimNextDueTaskMock.mockRejectedValue(new Error('db down'))

    const { dispatchDueAutopilotTasks, getAutopilotSchedulerStatus } = await import('../scheduler')

    await expect(dispatchDueAutopilotTasks()).rejects.toThrow('db down')
    expect(getAutopilotSchedulerStatus().lastDispatchError).toBe('db down')
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

  it('defaults scheduler mode to inline outside production', async () => {
    delete process.env.ARCHE_AUTOPILOT_SCHEDULER_MODE
    process.env.NODE_ENV = 'development'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const { getAutopilotSchedulerMode } = await import('../scheduler')

    expect(getAutopilotSchedulerMode()).toBe('inline')
    expect(logSpy).toHaveBeenCalledWith('[autopilot] Scheduler mode resolved', { mode: 'inline' })

    logSpy.mockRestore()
  })

  it('fails loudly when scheduler mode is unset in production', async () => {
    delete process.env.ARCHE_AUTOPILOT_SCHEDULER_MODE
    process.env.NODE_ENV = 'production'

    const { getAutopilotSchedulerMode } = await import('../scheduler')

    expect(() => getAutopilotSchedulerMode()).toThrow(
      'ARCHE_AUTOPILOT_SCHEDULER_MODE is required in production (missing value)',
    )
  })

  it('warns before falling back from an invalid non-production scheduler mode', async () => {
    process.env.ARCHE_AUTOPILOT_SCHEDULER_MODE = 'sidecar'
    process.env.NODE_ENV = 'development'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { getAutopilotSchedulerMode } = await import('../scheduler')

    expect(getAutopilotSchedulerMode()).toBe('inline')
    expect(warnSpy).toHaveBeenCalledWith('[autopilot] Invalid scheduler mode; falling back to inline', {
      env: 'ARCHE_AUTOPILOT_SCHEDULER_MODE',
      mode: 'sidecar',
    })

    logSpy.mockRestore()
    warnSpy.mockRestore()
  })
})
