import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalVitestEnv = process.env.VITEST

type ReaperStatus = {
  lastRunFinishedAt: Date | null
  lastRunStartedAt: Date | null
  running: boolean
}

function restoreVitestEnv() {
  if (originalVitestEnv === undefined) {
    delete process.env.VITEST
  } else {
    process.env.VITEST = originalVitestEnv
  }
}

function mockProcessOnce() {
  const handlers = new Map<string, () => void>()
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    handlers.set(String(event), listener as () => void)
    return process
  })
  return handlers
}

function mockReaperDaemonDependencies(options: {
  disconnect?: () => Promise<void>
  initWebPrisma?: () => Promise<void>
  status?: ReaperStatus
  stopReaper?: () => void
} = {}) {
  let status = options.status ?? {
    lastRunFinishedAt: null,
    lastRunStartedAt: null,
    running: true,
  }
  const initWebPrisma = vi.fn(options.initWebPrisma ?? (async () => {}))
  const disconnect = vi.fn(options.disconnect ?? (async () => {}))
  const startReaper = vi.fn()
  const stopReaper = vi.fn(options.stopReaper ?? (() => {}))
  const getReaperStatus = vi.fn(() => status)

  vi.doMock('@/lib/prisma', () => ({
    initWebPrisma,
    prisma: { $disconnect: disconnect },
  }))
  vi.doMock('@/lib/spawner/reaper', () => ({
    getReaperStatus,
    REAPER_INTERVAL_MS: 120_000,
    startReaper,
    stopReaper,
  }))

  return {
    disconnect,
    getReaperStatus,
    initWebPrisma,
    setStatus(nextStatus: ReaperStatus) {
      status = nextStatus
    },
    startReaper,
    stopReaper,
  }
}

describe('reaper daemon', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    process.env.VITEST = 'true'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    delete globalThis.archeReaperCleanupRegistered
  })

  afterEach(() => {
    restoreVitestEnv()
    delete globalThis.archeReaperCleanupRegistered
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/spawner/reaper')
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('starts the reaper and treats a missing heartbeat as healthy', async () => {
    const deps = mockReaperDaemonDependencies()
    const handlers = mockProcessOnce()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { startReaperDaemon } = await import('@/reaper-daemon')

    await startReaperDaemon()
    vi.advanceTimersByTime(60_000)

    expect(deps.initWebPrisma).toHaveBeenCalledTimes(1)
    expect(deps.startReaper).toHaveBeenCalledTimes(1)
    expect(handlers.has('SIGTERM')).toBe(true)
    expect(handlers.has('SIGINT')).toBe(true)
    expect(handlers.has('beforeExit')).toBe(true)
    expect(exit).not.toHaveBeenCalled()

    handlers.get('SIGINT')?.()
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT'))
  })

  it('exits when the watchdog sees a stopped reaper', async () => {
    mockReaperDaemonDependencies({
      status: {
        lastRunFinishedAt: null,
        lastRunStartedAt: null,
        running: false,
      },
    })
    vi.spyOn(process, 'once').mockImplementation(() => process)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const { startReaperDaemon } = await import('@/reaper-daemon')

    await startReaperDaemon()
    vi.advanceTimersByTime(60_000)

    expect(console.error).toHaveBeenCalledWith(
      '[reaper-daemon] Watchdog detected an unhealthy reaper state',
      expect.objectContaining({ running: false }),
    )
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('logs shutdown cleanup failures', async () => {
    const deps = mockReaperDaemonDependencies({
      disconnect: async () => { throw new Error('disconnect failed') },
      stopReaper: () => { throw new Error('stop failed') },
    })
    const handlers = mockProcessOnce()
    const { startReaperDaemon } = await import('@/reaper-daemon')

    await startReaperDaemon()
    handlers.get('beforeExit')?.()

    await vi.waitFor(() => expect(deps.disconnect).toHaveBeenCalled())
    expect(console.error).toHaveBeenCalledWith('[reaper-daemon] Failed to stop reaper', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('[reaper-daemon] Failed to disconnect Prisma', expect.any(Error))
  })

  it('does not register duplicate shutdown hooks', async () => {
    globalThis.archeReaperCleanupRegistered = true
    mockReaperDaemonDependencies()
    const once = vi.spyOn(process, 'once').mockImplementation(() => process)
    const { startReaperDaemon } = await import('@/reaper-daemon')

    await startReaperDaemon()

    expect(once).not.toHaveBeenCalled()
  })

  it('logs startup failures when run as the daemon entrypoint', async () => {
    delete process.env.VITEST
    mockReaperDaemonDependencies({
      initWebPrisma: async () => { throw new Error('init failed') },
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('@/reaper-daemon')

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(console.error).toHaveBeenCalledWith('[reaper-daemon] Failed to start reaper daemon', expect.any(Error))
  })
})
