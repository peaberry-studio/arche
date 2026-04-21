import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const disconnectMock = vi.fn()
const getReaperStatusMock = vi.fn()
const initWebPrismaMock = vi.fn()
const startReaperMock = vi.fn()
const stopReaperMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  initWebPrisma: (...args: unknown[]) => initWebPrismaMock(...args),
  prisma: {
    $disconnect: (...args: unknown[]) => disconnectMock(...args),
  },
}))

vi.mock('@/lib/spawner/reaper', () => ({
  getReaperStatus: (...args: unknown[]) => getReaperStatusMock(...args),
  REAPER_INTERVAL_MS: 300_000,
  startReaper: (...args: unknown[]) => startReaperMock(...args),
  stopReaper: (...args: unknown[]) => stopReaperMock(...args),
}))

describe('reaper daemon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    delete globalThis.archeReaperCleanupRegistered
    getReaperStatusMock.mockReturnValue({
      lastRunError: null,
      lastRunFinishedAt: new Date(),
      lastRunStartedAt: new Date(),
      running: true,
    })
    initWebPrismaMock.mockResolvedValue(undefined)
    disconnectMock.mockResolvedValue(undefined)
    stopReaperMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete globalThis.archeReaperCleanupRegistered
  })

  it('starts Prisma, the reaper, and shutdown hooks', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { startReaperDaemon } = await import('./reaper-daemon')
    await startReaperDaemon()

    expect(initWebPrismaMock).toHaveBeenCalledTimes(1)
    expect(startReaperMock).toHaveBeenCalledTimes(1)
    expect(processOnceSpy).toHaveBeenCalledTimes(3)

    processOnceSpy.mockRestore()
  })

  it('exits when the watchdog detects the reaper has stalled', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    const { REAPER_WATCHDOG_TIMEOUT_MS, startReaperDaemon } = await import('./reaper-daemon')
    await startReaperDaemon()

    getReaperStatusMock.mockReturnValue({
      lastRunError: 'boom',
      lastRunFinishedAt: new Date(Date.now() - REAPER_WATCHDOG_TIMEOUT_MS - 1_000),
      lastRunStartedAt: new Date(Date.now() - REAPER_WATCHDOG_TIMEOUT_MS - 1_000),
      running: true,
    })

    await vi.advanceTimersByTimeAsync(60_000)

    expect(processExitSpy).toHaveBeenCalledWith(1)

    processExitSpy.mockRestore()
    processOnceSpy.mockRestore()
  })

  it('stops the reaper and disconnects Prisma on SIGTERM', async () => {
    const handlers = new Map<string, () => void>()
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as never)
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(((event, handler) => {
      handlers.set(String(event), handler as () => void)
      return process
    }) as never)

    const { startReaperDaemon } = await import('./reaper-daemon')
    await startReaperDaemon()

    handlers.get('SIGTERM')?.()
    await vi.runAllTimersAsync()

    expect(stopReaperMock).toHaveBeenCalledTimes(1)
    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(processKillSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM')

    processKillSpy.mockRestore()
    processOnceSpy.mockRestore()
  })
})
