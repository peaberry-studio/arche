import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const disconnectMock = vi.fn()
const getAutopilotSchedulerModeMock = vi.fn()
const getAutopilotSchedulerStatusMock = vi.fn()
const initWebPrismaMock = vi.fn()
const startAutopilotSchedulerMock = vi.fn()
const stopAutopilotSchedulerMock = vi.fn()

const originalVitestEnv = process.env.VITEST

vi.mock('@/lib/prisma', () => ({
  initWebPrisma: (...args: unknown[]) => initWebPrismaMock(...args),
  prisma: {
    $disconnect: (...args: unknown[]) => disconnectMock(...args),
  },
}))

vi.mock('@/lib/autopilot/scheduler', () => ({
  AUTOPILOT_SCHEDULER_INTERVAL_MS: 30_000,
  getAutopilotSchedulerMode: (...args: unknown[]) => getAutopilotSchedulerModeMock(...args),
  getAutopilotSchedulerStatus: (...args: unknown[]) => getAutopilotSchedulerStatusMock(...args),
  startAutopilotScheduler: (...args: unknown[]) => startAutopilotSchedulerMock(...args),
  stopAutopilotScheduler: (...args: unknown[]) => stopAutopilotSchedulerMock(...args),
}))

function restoreVitestEnv(): void {
  if (originalVitestEnv === undefined) {
    delete process.env.VITEST
  } else {
    process.env.VITEST = originalVitestEnv
  }
}

describe('autopilot daemon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    process.env.VITEST = 'true'
    delete globalThis.archeAutopilotCleanupRegistered
    getAutopilotSchedulerModeMock.mockReturnValue('daemon')
    getAutopilotSchedulerStatusMock.mockReturnValue({
      dispatching: false,
      lastDispatchError: null,
      lastDispatchFinishedAt: new Date(),
      lastDispatchStartedAt: new Date(),
      running: true,
    })
    initWebPrismaMock.mockResolvedValue(undefined)
    disconnectMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    restoreVitestEnv()
    delete globalThis.archeAutopilotCleanupRegistered
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts Prisma, the scheduler, and shutdown hooks in daemon mode', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const { startAutopilotDaemon } = await import('./autopilot-daemon')
    await startAutopilotDaemon()

    expect(initWebPrismaMock).toHaveBeenCalledTimes(1)
    expect(startAutopilotSchedulerMock).toHaveBeenCalledTimes(1)
    expect(processOnceSpy).toHaveBeenCalledTimes(3)
    expect(logSpy).toHaveBeenCalledWith('[autopilot-daemon] Autopilot daemon started', { mode: 'daemon' })
  })

  it('does not run the daemon scheduler outside daemon mode', async () => {
    getAutopilotSchedulerModeMock.mockReturnValue('inline')
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const { startAutopilotDaemon } = await import('./autopilot-daemon')
    await startAutopilotDaemon()

    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
    expect(processOnceSpy).not.toHaveBeenCalled()
    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('[autopilot-daemon] Autopilot daemon not started for scheduler mode', {
      mode: 'inline',
    })
  })

  it('exits when the watchdog detects a stalled scheduler', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { AUTOPILOT_WATCHDOG_TIMEOUT_MS, startAutopilotDaemon } = await import('./autopilot-daemon')
    await startAutopilotDaemon()

    getAutopilotSchedulerStatusMock.mockReturnValue({
      dispatching: true,
      lastDispatchError: 'db timeout',
      lastDispatchFinishedAt: new Date(Date.now() - AUTOPILOT_WATCHDOG_TIMEOUT_MS - 1_000),
      lastDispatchStartedAt: new Date(Date.now() - AUTOPILOT_WATCHDOG_TIMEOUT_MS - 1_000),
      running: true,
    })

    await vi.advanceTimersByTimeAsync(60_000)

    expect(errorSpy).toHaveBeenCalledWith(
      '[autopilot-daemon] Watchdog detected an unhealthy scheduler state',
      expect.objectContaining({ dispatching: true, watchdogTimeoutMs: AUTOPILOT_WATCHDOG_TIMEOUT_MS }),
    )
    expect(processExitSpy).toHaveBeenCalledWith(1)

    processOnceSpy.mockRestore()
  })

  it('stops the scheduler and disconnects Prisma on SIGTERM', async () => {
    const handlers = new Map<string, () => void>()
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    vi.spyOn(process, 'once').mockImplementation((event, handler) => {
      handlers.set(String(event), handler as () => void)
      return process
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const { startAutopilotDaemon } = await import('./autopilot-daemon')
    await startAutopilotDaemon()

    handlers.get('SIGTERM')?.()

    await vi.waitFor(() => expect(processKillSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM'))
    expect(stopAutopilotSchedulerMock).toHaveBeenCalledTimes(1)
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })
})
