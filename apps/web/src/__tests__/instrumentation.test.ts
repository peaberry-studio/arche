import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalNextRuntime = process.env.NEXT_RUNTIME
const originalNodeEnv = process.env.NODE_ENV

function restoreEnv() {
  if (originalNextRuntime === undefined) {
    delete process.env.NEXT_RUNTIME
  } else {
    process.env.NEXT_RUNTIME = originalNextRuntime
  }

  process.env.NODE_ENV = originalNodeEnv
}

function mockProcessOnce() {
  const handlers = new Map<string, () => void>()
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    handlers.set(String(event), listener as () => void)
    return process
  })
  return handlers
}

function mockNodeInstrumentationDependencies(options: {
  disconnect?: () => Promise<void>
  isDesktop?: boolean
  shouldStartInlineAutopilotScheduler?: boolean
  stopAutopilotScheduler?: () => void
  stopReaper?: () => void
  stopSlackSocketManager?: () => void
} = {}) {
  const initWebPrisma = vi.fn(async () => {})
  const shouldStartInlineAutopilotScheduler = vi.fn(() => options.shouldStartInlineAutopilotScheduler ?? true)
  const startAutopilotScheduler = vi.fn()
  const startSlackSocketManager = vi.fn()
  const stopAutopilotScheduler = vi.fn(options.stopAutopilotScheduler ?? (() => {}))
  const stopReaper = vi.fn(options.stopReaper ?? (() => {}))
  const stopSlackSocketManager = vi.fn(options.stopSlackSocketManager ?? (() => {}))
  const disconnect = vi.fn(options.disconnect ?? (async () => {}))

  vi.doMock('@/lib/runtime/mode', () => ({
    isDesktop: vi.fn(() => options.isDesktop ?? false),
  }))
  vi.doMock('@/lib/prisma', () => ({
    initWebPrisma,
    prisma: { $disconnect: disconnect },
  }))
  vi.doMock('@/lib/autopilot/scheduler', () => ({
    shouldStartInlineAutopilotScheduler,
    startAutopilotScheduler,
    stopAutopilotScheduler,
  }))
  vi.doMock('@/lib/slack/socket-mode', () => ({
    startSlackSocketManager,
    stopSlackSocketManager,
  }))
  vi.doMock('@/lib/spawner/reaper', () => ({ stopReaper }))

  return {
    disconnect,
    initWebPrisma,
    shouldStartInlineAutopilotScheduler,
    startAutopilotScheduler,
    startSlackSocketManager,
    stopAutopilotScheduler,
    stopReaper,
    stopSlackSocketManager,
  }
}

describe('Next instrumentation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    delete globalThis.archeWebCleanupRegistered
  })

  afterEach(() => {
    restoreEnv()
    delete globalThis.archeWebCleanupRegistered
    vi.doUnmock('@/lib/autopilot/scheduler')
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/runtime/mode')
    vi.doUnmock('@/lib/slack/socket-mode')
    vi.doUnmock('@/lib/spawner/reaper')
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('skips registration outside the node runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    const { register } = await import('@/instrumentation')

    await expect(register()).resolves.toBeUndefined()
  })

  it('starts web runtime services and shuts them down from process hooks', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NODE_ENV = 'production'
    const deps = mockNodeInstrumentationDependencies()
    const handlers = mockProcessOnce()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { register } = await import('@/instrumentation')

    await register()

    expect(deps.initWebPrisma).toHaveBeenCalledTimes(1)
    expect(deps.startAutopilotScheduler).toHaveBeenCalledTimes(1)
    expect(deps.startSlackSocketManager).toHaveBeenCalledTimes(1)
    expect(handlers.has('SIGTERM')).toBe(true)
    expect(handlers.has('SIGINT')).toBe(true)
    expect(handlers.has('beforeExit')).toBe(true)

    handlers.get('beforeExit')?.()
    await vi.waitFor(() => expect(deps.disconnect).toHaveBeenCalled())
    expect(deps.stopAutopilotScheduler).toHaveBeenCalled()
    expect(deps.stopSlackSocketManager).toHaveBeenCalled()
    expect(deps.stopReaper).toHaveBeenCalled()

    handlers.get('SIGTERM')?.()
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM'))

    handlers.get('SIGINT')?.()
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT'))
  })

  it('skips web service startup in desktop mode', async () => {
    const deps = mockNodeInstrumentationDependencies({ isDesktop: true })
    const { registerNodeInstrumentation } = await import('@/instrumentation-node')

    await registerNodeInstrumentation()

    expect(deps.initWebPrisma).not.toHaveBeenCalled()
    expect(deps.startSlackSocketManager).not.toHaveBeenCalled()
  })

  it('does not start inline autopilot scheduler in daemon mode', async () => {
    process.env.NODE_ENV = 'production'
    const deps = mockNodeInstrumentationDependencies({ shouldStartInlineAutopilotScheduler: false })
    const { registerNodeInstrumentation } = await import('@/instrumentation-node')

    await registerNodeInstrumentation()

    expect(deps.shouldStartInlineAutopilotScheduler).toHaveBeenCalled()
    expect(deps.startAutopilotScheduler).not.toHaveBeenCalled()
    expect(deps.startSlackSocketManager).toHaveBeenCalled()
  })

  it('logs cleanup failures during graceful shutdown', async () => {
    process.env.NODE_ENV = 'production'
    const deps = mockNodeInstrumentationDependencies({
      disconnect: async () => { throw new Error('prisma failed') },
      stopAutopilotScheduler: () => { throw new Error('scheduler failed') },
      stopReaper: () => { throw new Error('reaper failed') },
      stopSlackSocketManager: () => { throw new Error('slack failed') },
    })
    const handlers = mockProcessOnce()
    const { registerNodeInstrumentation } = await import('@/instrumentation-node')

    await registerNodeInstrumentation()
    handlers.get('beforeExit')?.()

    await vi.waitFor(() => expect(deps.disconnect).toHaveBeenCalled())
    expect(console.error).toHaveBeenCalledWith(
      '[shutdown] Failed to stop autopilot scheduler:',
      expect.any(Error),
    )
    expect(console.error).toHaveBeenCalledWith(
      '[shutdown] Failed to stop Slack socket manager:',
      expect.any(Error),
    )
    expect(console.error).toHaveBeenCalledWith('[shutdown] Failed to stop reaper:', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('[shutdown] Failed to disconnect Prisma:', expect.any(Error))
  })
})
