import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const accessMock = vi.fn()
const disconnectMock = vi.fn()
const getAutopilotSchedulerModeMock = vi.fn()
const getAutopilotSchedulerStatusMock = vi.fn()
const hasBareRepoLayoutMock = vi.fn()
const initWebPrismaMock = vi.fn()
const resolveRepoRootMock = vi.fn()
const startAutopilotSchedulerMock = vi.fn()
const statMock = vi.fn()
const stopAutopilotSchedulerMock = vi.fn()

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => accessMock(...args),
  stat: (...args: unknown[]) => statMock(...args),
}))

vi.mock('@/lib/git/bare-repo', () => ({
  hasBareRepoLayout: (...args: unknown[]) => hasBareRepoLayoutMock(...args),
  resolveRepoRoot: (...args: unknown[]) => resolveRepoRootMock(...args),
}))

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

vi.mock('@/lib/runtime/paths', () => ({
  getKbConfigRoot: () => '/kb-config',
  getUsersBasePath: () => '/users',
}))

import { AUTOPILOT_WATCHDOG_TIMEOUT_MS, startAutopilotDaemon } from '@/autopilot-daemon'

describe('autopilot daemon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.archeAutopilotCleanupRegistered = undefined
    disconnectMock.mockResolvedValue(undefined)
    getAutopilotSchedulerModeMock.mockReturnValue('daemon')
    getAutopilotSchedulerStatusMock.mockReturnValue({
      lastDispatchFinishedAt: new Date(Date.now()),
      lastDispatchStartedAt: null,
      running: true,
    })
    accessMock.mockResolvedValue(undefined)
    hasBareRepoLayoutMock.mockResolvedValue(true)
    initWebPrismaMock.mockResolvedValue(undefined)
    resolveRepoRootMock.mockResolvedValue('/kb-config')
    statMock.mockResolvedValue({ isDirectory: () => true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    globalThis.archeAutopilotCleanupRegistered = undefined
  })

  it('disconnects without starting when scheduler mode is not daemon', async () => {
    getAutopilotSchedulerModeMock.mockReturnValue('web')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await startAutopilotDaemon()

    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
  })

  it('starts the scheduler, monitors heartbeat, and cleans up before exit', async () => {
    vi.useFakeTimers()
    const shutdownHandlers = new Map<string | symbol, (...args: unknown[]) => void>()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'once').mockImplementation((eventName, listener) => {
      shutdownHandlers.set(eventName, listener as (...args: unknown[]) => void)
      return process
    })

    await startAutopilotDaemon()

    expect(AUTOPILOT_WATCHDOG_TIMEOUT_MS).toBe(240_000)
    expect(initWebPrismaMock).toHaveBeenCalledTimes(1)
    expect(startAutopilotSchedulerMock).toHaveBeenCalledTimes(1)
    expect(shutdownHandlers.has('SIGTERM')).toBe(true)
    expect(shutdownHandlers.has('SIGINT')).toBe(true)
    expect(shutdownHandlers.has('beforeExit')).toBe(true)

    vi.advanceTimersByTime(60_000)

    shutdownHandlers.get('beforeExit')?.()
    await vi.waitFor(() => expect(disconnectMock).toHaveBeenCalledTimes(1))
    expect(stopAutopilotSchedulerMock).toHaveBeenCalledTimes(1)
  })

  it('exits when the watchdog sees an unhealthy scheduler', async () => {
    vi.useFakeTimers()
    getAutopilotSchedulerStatusMock.mockReturnValue({
      lastDispatchFinishedAt: null,
      lastDispatchStartedAt: null,
      running: false,
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit)
    vi.spyOn(process, 'once').mockImplementation(() => process)

    await startAutopilotDaemon()
    vi.advanceTimersByTime(60_000)

    expect(console.error).toHaveBeenCalledWith(
      '[autopilot-daemon] Watchdog detected an unhealthy scheduler state',
      expect.objectContaining({ watchdogTimeoutMs: AUTOPILOT_WATCHDOG_TIMEOUT_MS }),
    )
    expect(process.exit).toHaveBeenCalledWith(1)
  })
})
