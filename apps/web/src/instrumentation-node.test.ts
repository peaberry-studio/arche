import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const initWebPrismaMock = vi.fn()
const isDesktopMock = vi.fn()
const shouldStartInlineFlowSchedulerMock = vi.fn()
const startFlowSchedulerMock = vi.fn()
const startReaperMock = vi.fn()
const startSlackSocketManagerMock = vi.fn()

vi.mock('@/lib/flows/scheduler', () => ({
  shouldStartInlineFlowScheduler: (...args: unknown[]) => shouldStartInlineFlowSchedulerMock(...args),
  startFlowScheduler: (...args: unknown[]) => startFlowSchedulerMock(...args),
  stopFlowScheduler: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  initWebPrisma: (...args: unknown[]) => initWebPrismaMock(...args),
  prisma: { $disconnect: vi.fn() },
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/slack/socket-mode', () => ({
  startSlackSocketManager: (...args: unknown[]) => startSlackSocketManagerMock(...args),
  stopSlackSocketManager: vi.fn(),
}))

vi.mock('@/lib/spawner/reaper', () => ({
  startReaper: (...args: unknown[]) => startReaperMock(...args),
  stopReaper: vi.fn(),
}))

describe('registerNodeInstrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete globalThis.archeWebCleanupRegistered
    isDesktopMock.mockReturnValue(false)
    shouldStartInlineFlowSchedulerMock.mockReturnValue(true)
    initWebPrismaMock.mockResolvedValue(undefined)
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete globalThis.archeWebCleanupRegistered
  })

  it('starts Prisma, Slack, and flows in production web mode', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(initWebPrismaMock).toHaveBeenCalledTimes(1)
    expect(startReaperMock).not.toHaveBeenCalled()
    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(1)
    expect(startFlowSchedulerMock).toHaveBeenCalledTimes(1)
    expect(processOnceSpy).toHaveBeenCalledTimes(3)
    expect(processOnceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(processOnceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(processOnceSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function))

    processOnceSpy.mockRestore()
  })

  it('skips flows outside production but still starts Slack', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(initWebPrismaMock).toHaveBeenCalledTimes(1)
    expect(startReaperMock).not.toHaveBeenCalled()
    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(1)
    expect(startFlowSchedulerMock).not.toHaveBeenCalled()
    expect(processOnceSpy).toHaveBeenCalledTimes(3)

    processOnceSpy.mockRestore()
  })

  it('skips inline flow startup when scheduler mode is daemon', async () => {
    shouldStartInlineFlowSchedulerMock.mockReturnValue(false)
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(shouldStartInlineFlowSchedulerMock).toHaveBeenCalledTimes(1)
    expect(startFlowSchedulerMock).not.toHaveBeenCalled()
    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(1)

    processOnceSpy.mockRestore()
  })

  it('logs inline flow startup failures and keeps booting', async () => {
    const error = new Error('missing scheduler mode')
    shouldStartInlineFlowSchedulerMock.mockImplementation(() => { throw error })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(errorSpy).toHaveBeenCalledWith('[flows] Failed to start scheduler', error)
    expect(startFlowSchedulerMock).not.toHaveBeenCalled()
    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(1)
    expect(processOnceSpy).toHaveBeenCalledTimes(3)

    errorSpy.mockRestore()
    processOnceSpy.mockRestore()
  })

  it('returns early in desktop mode', async () => {
    isDesktopMock.mockReturnValue(true)
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startReaperMock).not.toHaveBeenCalled()
    expect(startSlackSocketManagerMock).not.toHaveBeenCalled()
    expect(startFlowSchedulerMock).not.toHaveBeenCalled()
    expect(processOnceSpy).not.toHaveBeenCalled()

    processOnceSpy.mockRestore()
  })

  it('registers shutdown hooks only once across repeated startup calls', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()
    await registerNodeInstrumentation()

    expect(startReaperMock).not.toHaveBeenCalled()
    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(2)
    expect(processOnceSpy).toHaveBeenCalledTimes(3)

    processOnceSpy.mockRestore()
  })
})
