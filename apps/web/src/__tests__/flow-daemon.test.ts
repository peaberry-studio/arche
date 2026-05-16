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
  access?: () => Promise<void>
  disconnect?: () => Promise<void>
  hasBareRepoLayout?: () => Promise<boolean>
  initWebPrisma?: () => Promise<void>
  mode?: 'daemon' | 'inline' | 'off'
  resolveRepoRoot?: () => Promise<string | null>
  status?: FlowSchedulerStatus
  stat?: () => Promise<{ isDirectory: () => boolean }>
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
  const access = vi.fn(options.access ?? (async () => {}))
  const disconnect = vi.fn(options.disconnect ?? (async () => {}))
  const hasBareRepoLayout = vi.fn(options.hasBareRepoLayout ?? (async () => true))
  const resolveRepoRoot = vi.fn(options.resolveRepoRoot ?? (async () => '/kb-config'))
  const startFlowScheduler = vi.fn()
  const stat = vi.fn(options.stat ?? (async () => ({ isDirectory: () => true })))
  const stopFlowScheduler = vi.fn(options.stopFlowScheduler ?? (() => {}))
  const getFlowSchedulerMode = vi.fn(() => options.mode ?? 'daemon')
  const getFlowSchedulerStatus = vi.fn(() => status)

  vi.doMock('node:fs/promises', () => ({
    access,
    stat,
  }))
  vi.doMock('@/lib/prisma', () => ({
    initWebPrisma,
    prisma: { $disconnect: disconnect },
  }))
  vi.doMock('@/lib/git/bare-repo', () => ({
    hasBareRepoLayout,
    resolveRepoRoot,
  }))
  vi.doMock('@/lib/runtime/paths', () => ({
    getKbConfigRoot: () => '/kb-config',
    getUsersBasePath: () => '/users',
  }))
  vi.doMock('@/lib/flows/scheduler', () => ({
    FLOW_SCHEDULER_INTERVAL_MS: 30_000,
    getFlowSchedulerMode,
    getFlowSchedulerStatus,
    startFlowScheduler,
    stopFlowScheduler,
  }))

  return {
    access,
    disconnect,
    getFlowSchedulerMode,
    getFlowSchedulerStatus,
    hasBareRepoLayout,
    initWebPrisma,
    resolveRepoRoot,
    setStatus(nextStatus: FlowSchedulerStatus) {
      status = nextStatus
    },
    startFlowScheduler,
    stat,
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
    vi.doUnmock('@/lib/git/bare-repo')
    vi.doUnmock('@/lib/runtime/paths')
    vi.doUnmock('node:fs/promises')
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
    expect(deps.resolveRepoRoot).toHaveBeenCalledWith('/kb-config')
    expect(deps.hasBareRepoLayout).toHaveBeenCalledWith('/kb-config')
    expect(deps.stat).toHaveBeenCalledWith('/users')
    expect(deps.access).toHaveBeenCalled()
    expect(deps.startFlowScheduler).toHaveBeenCalledTimes(1)
    expect(handlers.has('SIGTERM')).toBe(true)
    expect(handlers.has('SIGINT')).toBe(true)
    expect(handlers.has('beforeExit')).toBe(true)
    expect(exit).not.toHaveBeenCalled()

    handlers.get('SIGTERM')?.()
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM'))
  })

  it('fails before starting when KB config is unavailable', async () => {
    const deps = mockFlowDaemonDependencies({ resolveRepoRoot: async () => null })
    const { startFlowDaemon } = await import('@/flow-daemon')

    await expect(startFlowDaemon()).rejects.toThrow('kb_unavailable: /kb-config does not exist or is not a directory')
    expect(deps.initWebPrisma).not.toHaveBeenCalled()
    expect(deps.startFlowScheduler).not.toHaveBeenCalled()
  })

  it('fails before starting when user data is unavailable', async () => {
    const deps = mockFlowDaemonDependencies({ stat: async () => ({ isDirectory: () => false }) })
    const { startFlowDaemon } = await import('@/flow-daemon')

    await expect(startFlowDaemon()).rejects.toThrow('user_data_unavailable: /users does not exist or is not a directory')
    expect(deps.initWebPrisma).not.toHaveBeenCalled()
    expect(deps.startFlowScheduler).not.toHaveBeenCalled()
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
