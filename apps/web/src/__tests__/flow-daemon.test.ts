import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalVitestEnv = process.env.VITEST

type FlowSchedulerStatus = {
  dispatching: boolean
  lastDispatchError: string | null
  lastDispatchFinishedAt: Date | null
  lastDispatchStartedAt: Date | null
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

function mockFlowDaemonDependencies(options: {
  disconnect?: () => Promise<void>
  initWebPrisma?: () => Promise<void>
  mode?: 'daemon' | 'inline' | 'off'
  status?: FlowSchedulerStatus
  stopFlowScheduler?: () => void
} = {}) {
  let status = options.status ?? {
    dispatching: false,
    lastDispatchError: null,
    lastDispatchFinishedAt: null,
    lastDispatchStartedAt: null,
    running: true,
  }
  const initWebPrisma = vi.fn(options.initWebPrisma ?? (async () => {}))
  const disconnect = vi.fn(options.disconnect ?? (async () => {}))
  const startFlowScheduler = vi.fn()
  const stopFlowScheduler = vi.fn(options.stopFlowScheduler ?? (() => {}))
  const getFlowSchedulerMode = vi.fn(() => options.mode ?? 'daemon')
  const getFlowSchedulerStatus = vi.fn(() => status)

  vi.doMock('@/lib/prisma', () => ({
    initWebPrisma,
    prisma: { $disconnect: disconnect },
  }))
  vi.doMock('@/lib/flows/scheduler', () => ({
    FLOW_SCHEDULER_INTERVAL_MS: 30_000,
    getFlowSchedulerMode,
    getFlowSchedulerStatus,
    startFlowScheduler,
    stopFlowScheduler,
  }))

  return {
    disconnect,
    getFlowSchedulerMode,
    getFlowSchedulerStatus,
    initWebPrisma,
    setStatus(nextStatus: FlowSchedulerStatus) {
      status = nextStatus
    },
    startFlowScheduler,
    stopFlowScheduler,
  }
}

describe('flow daemon', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    process.env.VITEST = 'true'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    delete globalThis.archeFlowCleanupRegistered
  })

  afterEach(() => {
    restoreVitestEnv()
    delete globalThis.archeFlowCleanupRegistered
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/flows/scheduler')
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('disconnects without starting when scheduler mode is not daemon', async () => {
    const deps = mockFlowDaemonDependencies({ mode: 'inline' })
    const { startFlowDaemon } = await import('@/flow-daemon')

    await startFlowDaemon()

    expect(deps.initWebPrisma).not.toHaveBeenCalled()
    expect(deps.startFlowScheduler).not.toHaveBeenCalled()
    expect(deps.disconnect).toHaveBeenCalledTimes(1)
    expect(console.log).toHaveBeenCalledWith('[flow-daemon] Flow daemon not started for scheduler mode', { mode: 'inline' })
  })

  it('starts the scheduler and treats a missing heartbeat as healthy', async () => {
    const deps = mockFlowDaemonDependencies()
    const handlers = mockProcessOnce()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { startFlowDaemon } = await import('@/flow-daemon')

    await startFlowDaemon()
    vi.advanceTimersByTime(60_000)

    expect(deps.initWebPrisma).toHaveBeenCalledTimes(1)
    expect(deps.startFlowScheduler).toHaveBeenCalledTimes(1)
    expect(handlers.has('SIGTERM')).toBe(true)
    expect(handlers.has('SIGINT')).toBe(true)
    expect(handlers.has('beforeExit')).toBe(true)
    expect(exit).not.toHaveBeenCalled()

    handlers.get('SIGTERM')?.()
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM'))
  })

  it('exits when the watchdog sees a stopped scheduler', async () => {
    mockFlowDaemonDependencies({
      status: {
        dispatching: false,
        lastDispatchError: null,
        lastDispatchFinishedAt: null,
        lastDispatchStartedAt: null,
        running: false,
      },
    })
    vi.spyOn(process, 'once').mockImplementation(() => process)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const { startFlowDaemon } = await import('@/flow-daemon')

    await startFlowDaemon()
    vi.advanceTimersByTime(60_000)

    expect(console.error).toHaveBeenCalledWith(
      '[flow-daemon] Watchdog detected an unhealthy scheduler state',
      expect.objectContaining({ running: false }),
    )
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('logs shutdown cleanup failures', async () => {
    const deps = mockFlowDaemonDependencies({
      disconnect: async () => { throw new Error('disconnect failed') },
      stopFlowScheduler: () => { throw new Error('stop failed') },
    })
    const handlers = mockProcessOnce()
    const { startFlowDaemon } = await import('@/flow-daemon')

    await startFlowDaemon()
    handlers.get('beforeExit')?.()

    await vi.waitFor(() => expect(deps.disconnect).toHaveBeenCalled())
    expect(console.error).toHaveBeenCalledWith('[flow-daemon] Failed to stop flow scheduler', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('[flow-daemon] Failed to disconnect Prisma', expect.any(Error))
  })

  it('does not register duplicate shutdown hooks', async () => {
    globalThis.archeFlowCleanupRegistered = true
    mockFlowDaemonDependencies()
    const once = vi.spyOn(process, 'once').mockImplementation(() => process)
    const { startFlowDaemon } = await import('@/flow-daemon')

    await startFlowDaemon()

    expect(once).not.toHaveBeenCalled()
  })

  it('logs startup failures when run as the daemon entrypoint', async () => {
    delete process.env.VITEST
    mockFlowDaemonDependencies({
      initWebPrisma: async () => { throw new Error('init failed') },
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('@/flow-daemon')

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(console.error).toHaveBeenCalledWith('[flow-daemon] Failed to start flow daemon', expect.any(Error))
  })
})
