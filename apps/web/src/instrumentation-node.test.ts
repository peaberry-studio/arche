import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const initWebPrismaMock = vi.fn()
const isDesktopMock = vi.fn()
const startAutopilotSchedulerMock = vi.fn()
const startSlackSocketManagerMock = vi.fn()

vi.mock('@/lib/autopilot/scheduler', () => ({
  startAutopilotScheduler: (...args: unknown[]) => startAutopilotSchedulerMock(...args),
  stopAutopilotScheduler: vi.fn(),
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

describe('registerNodeInstrumentation', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete globalThis.archeWebCleanupRegistered
    isDesktopMock.mockReturnValue(false)
    initWebPrismaMock.mockResolvedValue(undefined)
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    delete globalThis.archeWebCleanupRegistered
  })

  it('starts Prisma, Slack, and autopilot in production web mode', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(initWebPrismaMock).toHaveBeenCalledTimes(1)
    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(1)
    expect(startAutopilotSchedulerMock).toHaveBeenCalledTimes(1)
    expect(processOnceSpy).toHaveBeenCalledTimes(3)
    expect(processOnceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(processOnceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(processOnceSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function))

    processOnceSpy.mockRestore()
  })

  it('skips autopilot outside production but still starts Slack', async () => {
    process.env.NODE_ENV = 'development'
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(initWebPrismaMock).toHaveBeenCalledTimes(1)
    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(1)
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
    expect(processOnceSpy).toHaveBeenCalledTimes(3)

    processOnceSpy.mockRestore()
  })

  it('returns early in desktop mode', async () => {
    isDesktopMock.mockReturnValue(true)
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()

    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startSlackSocketManagerMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
    expect(processOnceSpy).not.toHaveBeenCalled()

    processOnceSpy.mockRestore()
  })

  it('registers shutdown hooks only once across repeated startup calls', async () => {
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)

    const { registerNodeInstrumentation } = await import('./instrumentation-node')
    await registerNodeInstrumentation()
    await registerNodeInstrumentation()

    expect(startSlackSocketManagerMock).toHaveBeenCalledTimes(2)
    expect(processOnceSpy).toHaveBeenCalledTimes(3)

    processOnceSpy.mockRestore()
  })
})
