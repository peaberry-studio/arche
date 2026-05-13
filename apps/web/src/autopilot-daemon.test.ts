import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const accessMock = vi.fn()
const disconnectMock = vi.fn()
const getAutopilotSchedulerModeMock = vi.fn()
const getAutopilotSchedulerStatusMock = vi.fn()
const getKbConfigRootMock = vi.fn()
const getUsersBasePathMock = vi.fn()
const hasBareRepoLayoutMock = vi.fn()
const initWebPrismaMock = vi.fn()
const resolveRepoRootMock = vi.fn()
const startAutopilotSchedulerMock = vi.fn()
const statMock = vi.fn()
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

vi.mock('@/lib/git/bare-repo', () => ({
  hasBareRepoLayout: (...args: unknown[]) => hasBareRepoLayoutMock(...args),
  resolveRepoRoot: (...args: unknown[]) => resolveRepoRootMock(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbConfigRoot: (...args: unknown[]) => getKbConfigRootMock(...args),
  getUsersBasePath: (...args: unknown[]) => getUsersBasePathMock(...args),
}))

vi.mock('node:fs', () => ({
  constants: { W_OK: 2 },
}))

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => accessMock(...args),
  stat: (...args: unknown[]) => statMock(...args),
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
    getKbConfigRootMock.mockReturnValue('/kb-config')
    getUsersBasePathMock.mockReturnValue('/opt/arche/users')
    hasBareRepoLayoutMock.mockResolvedValue(true)
    initWebPrismaMock.mockResolvedValue(undefined)
    disconnectMock.mockResolvedValue(undefined)
    resolveRepoRootMock.mockResolvedValue('/kb-config')
    accessMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue({ isDirectory: () => true })
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
    expect(resolveRepoRootMock).toHaveBeenCalledWith('/kb-config')
    expect(hasBareRepoLayoutMock).toHaveBeenCalledWith('/kb-config')
    expect(statMock).toHaveBeenCalledWith('/opt/arche/users')
    expect(accessMock).toHaveBeenCalledWith('/opt/arche/users', 2)
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
    expect(resolveRepoRootMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
    expect(processOnceSpy).not.toHaveBeenCalled()
    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('[autopilot-daemon] Autopilot daemon not started for scheduler mode', {
      mode: 'inline',
    })
  })

  it('fails fast when the KB config root is unavailable', async () => {
    resolveRepoRootMock.mockResolvedValue(null)

    const { startAutopilotDaemon } = await import('./autopilot-daemon')

    await expect(startAutopilotDaemon()).rejects.toThrow(
      'kb_unavailable: /kb-config does not exist or is not a directory'
    )
    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
    expect(statMock).not.toHaveBeenCalled()
  })

  it('fails fast when the KB config root is not a bare repo', async () => {
    hasBareRepoLayoutMock.mockResolvedValue(false)

    const { startAutopilotDaemon } = await import('./autopilot-daemon')

    await expect(startAutopilotDaemon()).rejects.toThrow(
      'kb_unavailable: /kb-config is not a bare git repository'
    )
    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
    expect(statMock).not.toHaveBeenCalled()
  })

  it('fails fast when the user data root is unavailable', async () => {
    statMock.mockRejectedValue(new Error('missing'))

    const { startAutopilotDaemon } = await import('./autopilot-daemon')

    await expect(startAutopilotDaemon()).rejects.toThrow(
      'user_data_unavailable: /opt/arche/users does not exist or is not a directory'
    )
    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
  })

  it('fails fast when the user data root is not writable', async () => {
    accessMock.mockRejectedValue(new Error('permission denied'))

    const { startAutopilotDaemon } = await import('./autopilot-daemon')

    await expect(startAutopilotDaemon()).rejects.toThrow(
      'user_data_unavailable: /opt/arche/users is not writable'
    )
    expect(initWebPrismaMock).not.toHaveBeenCalled()
    expect(startAutopilotSchedulerMock).not.toHaveBeenCalled()
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
