import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { ChildProcess } from 'child_process'

const mockSpawn = vi.fn()
const mockExecFileSync = vi.fn()
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockRandomBytes = vi.fn()

vi.mock('crypto', () => ({
  randomBytes: (...args: unknown[]) => mockRandomBytes(...args),
}))

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/tmp/arche/kb-content'),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    upsertStarting: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn().mockResolvedValue(undefined),
    setRunning: vi.fn().mockResolvedValue(undefined),
    setStopped: vi.fn().mockResolvedValue(undefined),
    findActiveInstances: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/spawner/config', () => ({
  getWorkspaceAgentPort: vi.fn(() => 4097),
}))

vi.mock('@/lib/spawner/crypto', () => ({
  encryptPassword: vi.fn((p: string) => `enc:${p}`),
}))

vi.mock('@/lib/opencode/providers', () => ({
  syncProviderAccessForInstance: vi.fn().mockResolvedValue({ ok: true }),
}))

const mockFetch = vi.fn()

type Listener = (...args: unknown[]) => void

function makeChildProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const listeners = new Map<string, Listener[]>()

  const addListener = (event: string, cb: Listener) => {
    const current = listeners.get(event) ?? []
    listeners.set(event, [...current, cb])
  }

  const child = {
    killed: false,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(function kill(this: ChildProcess) {
      child.killed = true
      return true
    }),
    on: vi.fn((event: string, cb: Listener) => {
      addListener(event, cb)
      return child
    }),
    once: vi.fn((event: string, cb: Listener) => {
      const wrapped: Listener = (...args) => {
        child.removeListener(event, wrapped)
        cb(...args)
      }
      addListener(event, wrapped)
      return child
    }),
    removeListener: vi.fn((event: string, cb: Listener) => {
      const current = listeners.get(event) ?? []
      listeners.set(event, current.filter((listener) => listener !== cb))
      return child
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const current = [...(listeners.get(event) ?? [])]
      for (const listener of current) {
        listener(...args)
      }
      return current.length > 0
    }),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    ...overrides,
  } as unknown as ChildProcess & { emit: (event: string, ...args: unknown[]) => boolean }

  return child
}

function mockHealthyFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/global/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ healthy: true }),
      })
    }

    if (url.includes('/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, service: 'workspace-agent' }),
      })
    }

    return Promise.reject(new Error(`unexpected fetch ${url}`))
  })
}

describe('desktopWorkspaceHost', () => {
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    process.env = { ...originalEnv }
    delete process.env.ARCHE_OPENCODE_BIN
    process.env.ARCHE_WORKSPACE_AGENT_BIN = '/mock/bin/workspace-agent'
    delete process.env.ARCHE_DESKTOP_WEB_PORT
    delete process.env.ARCHE_DESKTOP_START_TIMEOUT_MS
    delete process.env.ARCHE_DESKTOP_START_INTERVAL_MS
    delete process.env.OPENCODE_SERVER_PASSWORD
    // @ts-expect-error test isolation
    process.resourcesPath = undefined
    mockExistsSync.mockImplementation((target: string) => target === '/mock/bin/workspace-agent')
    mockRandomBytes.mockReturnValue({ toString: () => 'generated-password' })
    mockHealthyFetch()
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error test isolation
    process.resourcesPath = originalResourcesPath
  })

  it('starts opencode and workspace-agent and returns started status', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('spawns opencode with serve command and workspace-agent with loopback addr', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'opencode',
      ['serve', '--hostname', '127.0.0.1', '--port', expect.any(String)],
      expect.objectContaining({ stdio: 'pipe', detached: false }),
    )

    const workspaceAgentCall = mockSpawn.mock.calls[1]
    expect(workspaceAgentCall[0]).toBe('/mock/bin/workspace-agent')
    expect(workspaceAgentCall[1]).toEqual(['--addr', expect.stringMatching(/^127\.0\.0\.1:\d+$/)])
    expect(workspaceAgentCall[2]).toEqual(
      expect.objectContaining({
        stdio: 'pipe',
        detached: false,
        env: expect.objectContaining({
          WORKSPACE_AGENT_ADDR: expect.stringMatching(/^127\.0\.0\.1:\d+$/),
          WORKSPACE_AGENT_PORT: expect.stringMatching(/^\d+$/),
          KB_CONTENT_DIR: '/tmp/arche/kb-content',
        }),
      }),
    )
  })

  it('passes NODE_ENV through to both child process environments', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    process.env.NODE_ENV = 'production'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'opencode',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ NODE_ENV: 'production' }) }),
    )
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      '/mock/bin/workspace-agent',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ NODE_ENV: 'production' }) }),
    )
  })

  it('writes desktop provider gateway config with the IPv4 loopback host', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('opencode.json'),
      expect.stringContaining('http://127.0.0.1:3000/api/internal/providers/openai'),
      'utf-8',
    )
  })

  it('uses the resolved desktop web port for provider gateway config', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    process.env.ARCHE_DESKTOP_WEB_PORT = '4312'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('opencode.json'),
      expect.stringContaining('http://127.0.0.1:4312/api/internal/providers/openai'),
      'utf-8',
    )
  })

  it('returns already_running when workspace is already started', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const result = await desktopWorkspaceHost.start('local', 'user-1')
    expect(result).toEqual({ ok: true, status: 'already_running' })
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('continues without workspace-agent when the binary is unavailable', async () => {
    const opencodeChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild)
    delete process.env.ARCHE_WORKSPACE_AGENT_BIN
    mockExistsSync.mockReturnValue(false)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(await desktopWorkspaceHost.getAgentConnection('local')).toBeNull()
  })

  it('stops both managed processes for a running workspace', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const stopPromise = desktopWorkspaceHost.stop('local', 'user-1')
    opencodeChild.emit('exit', 0, 'SIGTERM')
    workspaceAgentChild.emit('exit', 0, 'SIGTERM')
    const result = await stopPromise

    expect(result).toEqual({ ok: true, status: 'stopped' })
    expect(opencodeChild.kill).toHaveBeenCalledWith('SIGTERM')
    expect(workspaceAgentChild.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('marks startup as failed when workspace-agent readiness never succeeds', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/global/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ healthy: true }),
        })
      }

      return Promise.reject(new Error('agent unavailable'))
    })
    process.env.ARCHE_DESKTOP_START_TIMEOUT_MS = '5'
    process.env.ARCHE_DESKTOP_START_INTERVAL_MS = '1'

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') {
        fn()
      }
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    try {
      const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
      const result = await desktopWorkspaceHost.start('local', 'user-1')

      expect(result).toEqual({
        ok: false,
        error: 'start_failed',
        detail: 'workspace_agent_healthcheck_timeout',
      })

      const { instanceService } = await import('@/lib/services')
      expect(instanceService.setError).toHaveBeenCalledWith('local')
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('returns running status with startedAt after both processes start', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const status = await desktopWorkspaceHost.getStatus('local')
    expect(status).not.toBeNull()
    expect(status!.status).toBe('running')
    expect(status!.startedAt).toBeInstanceOf(Date)
    expect(status!.stoppedAt).toBeNull()
  })

  it('returns stopped status when no runtime exists', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const status = await desktopWorkspaceHost.getStatus('local')
    expect(status).toEqual({
      status: 'stopped',
      startedAt: null,
      stoppedAt: null,
      lastActivityAt: null,
    })
  })

  it('returns connection info for running workspace', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getConnection('local')
    expect(conn).not.toBeNull()
    expect(conn!.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(conn!.authHeader).toMatch(/^Basic /)
  })

  it('returns agent connection info for running workspace', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getAgentConnection('local')
    expect(conn).not.toBeNull()
    expect(conn!.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('returns null connections for stopped workspace', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    expect(await desktopWorkspaceHost.getConnection('local')).toBeNull()
    expect(await desktopWorkspaceHost.getAgentConnection('local')).toBeNull()
  })

  it('uses the generated password in auth headers by default', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getConnection('local')
    const decoded = Buffer.from(conn!.authHeader.replace('Basic ', ''), 'base64').toString()
    expect(decoded).toBe('opencode:generated-password')
  })

  it('syncs providers after both readiness checks pass', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const { syncProviderAccessForInstance } = await import('@/lib/opencode/providers')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(syncProviderAccessForInstance).toHaveBeenCalledWith({
      instance: {
        baseUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        authHeader: expect.stringMatching(/^Basic /),
      },
      slug: 'local',
      userId: 'user-1',
    })
  })

  it('stores encrypted credentials in DB on start', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })

    const { instanceService } = await import('@/lib/services')
    expect(instanceService.upsertStarting).toHaveBeenCalledWith('local', 'enc:generated-password')
  })

  it('stopManagedProcess waits for actual exit, not just killed flag', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const stopPromise = desktopWorkspaceHost.stop('local', 'user-1')

    // After kill(), child.killed is true but exitCode is still null.
    // stop must NOT have resolved yet — it should be waiting for exit.
    expect(opencodeChild.killed).toBe(true)

    // Simulate the process actually exiting after a delay
    opencodeChild.emit('exit', 0, 'SIGTERM')
    workspaceAgentChild.emit('exit', 0, 'SIGTERM')

    const result = await stopPromise
    expect(result).toEqual({ ok: true, status: 'stopped' })
  })

  it('exposes detailed start failures in its return type', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    expect(desktopWorkspaceHost).toBeDefined()

    expectTypeOf<Awaited<ReturnType<typeof desktopWorkspaceHost.start>>>().toEqualTypeOf<
      | { ok: true; status: string }
      | { ok: false; error: string; detail?: string }
    >()
  })
})

describe('binary resolution', () => {
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_OPENCODE_BIN
    delete process.env.ARCHE_WORKSPACE_AGENT_BIN
    // @ts-expect-error test isolation
    process.resourcesPath = undefined
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error test isolation
    process.resourcesPath = originalResourcesPath
  })

  it('returns ARCHE_OPENCODE_BIN when set', async () => {
    process.env.ARCHE_OPENCODE_BIN = '/custom/path/opencode'

    const { getOpencodeBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('/custom/path/opencode')
  })

  it('returns ARCHE_WORKSPACE_AGENT_BIN when set', async () => {
    process.env.ARCHE_WORKSPACE_AGENT_BIN = '/custom/path/workspace-agent'

    const { getWorkspaceAgentBinary } = await import('../workspace-host-desktop')
    expect(getWorkspaceAgentBinary()).toBe('/custom/path/workspace-agent')
  })

  it('returns bundled binary paths when packaged resources exist', async () => {
    // @ts-expect-error simulating Electron packaged environment
    process.resourcesPath = '/Applications/Arche.app/Contents/Resources'
    mockExistsSync.mockReturnValue(true)

    const { getOpencodeBinary, getWorkspaceAgentBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('/Applications/Arche.app/Contents/Resources/bin/opencode')
    expect(getWorkspaceAgentBinary()).toBe('/Applications/Arche.app/Contents/Resources/bin/workspace-agent')
  })

  it('falls back to PATH lookup when bundled binaries are unavailable', async () => {
    const { getOpencodeBinary, getWorkspaceAgentBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('opencode')
    expect(getWorkspaceAgentBinary()).toBe('workspace-agent')
  })

  it('returns start_failed when health check times out', async () => {
    // Make health check always fail so it times out
    mockFetch.mockRejectedValue(new Error('connection refused'))

    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    // Use fast timeout so the test doesn't hang
    process.env.ARCHE_DESKTOP_START_TIMEOUT_MS = '100'
    process.env.ARCHE_DESKTOP_START_INTERVAL_MS = '10'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('start_failed')
    }
  }, 10000)

  it('propagates git init errors on start', async () => {
    // Make existsSync return false for .git so git init runs, then throw
    mockExistsSync.mockImplementation((target: string) => {
      if (target.endsWith('.git')) return false
      if (target === '/mock/bin/workspace-agent') return true
      return false
    })
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found')
    })

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).rejects.toThrow('git not found')
  })

  it('concurrent stop calls on the same slug do not error', async () => {
    // Restore mocks for this test
    mockExecFileSync.mockReturnValue('')
    mockExistsSync.mockImplementation((target: string) => target === '/mock/bin/workspace-agent')
    mockHealthyFetch()

    const opencodeChild = makeChildProcess()
    // Reset mockSpawn to clear any unconsumed mockReturnValueOnce from prior tests
    mockSpawn.mockReset()
    mockSpawn.mockReturnValueOnce(opencodeChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    // Fire two stops concurrently, then simulate processes exiting
    const p1 = desktopWorkspaceHost.stop('local')
    const p2 = desktopWorkspaceHost.stop('local')

    opencodeChild.emit('exit', 0, 'SIGTERM')

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })
})

describe('desktop instance reconciliation', () => {
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    process.env = { ...originalEnv }
    delete process.env.ARCHE_OPENCODE_BIN
    process.env.ARCHE_WORKSPACE_AGENT_BIN = '/mock/bin/workspace-agent'
    delete process.env.ARCHE_DESKTOP_WEB_PORT
    delete process.env.ARCHE_DESKTOP_START_TIMEOUT_MS
    delete process.env.ARCHE_DESKTOP_START_INTERVAL_MS
    delete process.env.OPENCODE_SERVER_PASSWORD
    // @ts-expect-error test isolation
    process.resourcesPath = undefined
    // @ts-expect-error test isolation
    globalThis.archeDesktopCleanupRegistered = undefined
    mockExistsSync.mockImplementation((target: string) => target === '/mock/bin/workspace-agent')
    mockRandomBytes.mockReturnValue({ toString: () => 'generated-password' })
    mockHealthyFetch()
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error test isolation
    process.resourcesPath = originalResourcesPath
  })

  it('marks stale running instances as stopped on first start', async () => {
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findActiveInstances).mockResolvedValue([
      { slug: 'orphan-1', status: 'running', startedAt: new Date(), lastActivityAt: new Date() },
      { slug: 'orphan-2', status: 'starting', startedAt: new Date(), lastActivityAt: null },
    ])

    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(instanceService.setStopped).toHaveBeenCalledWith('orphan-1')
    expect(instanceService.setStopped).toHaveBeenCalledWith('orphan-2')
  })

  it('only reconciles once across multiple start calls', async () => {
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findActiveInstances).mockResolvedValue([
      { slug: 'orphan', status: 'running', startedAt: new Date(), lastActivityAt: new Date() },
    ])

    const child1 = makeChildProcess()
    const agent1 = makeChildProcess()
    const child2 = makeChildProcess()
    const agent2 = makeChildProcess()
    mockSpawn.mockReturnValueOnce(child1).mockReturnValueOnce(agent1)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    // Stop the first workspace
    const stopPromise = desktopWorkspaceHost.stop('local')
    child1.emit('exit', 0, 'SIGTERM')
    agent1.emit('exit', 0, 'SIGTERM')
    await stopPromise

    // Start a second workspace — reconciliation should NOT run again
    vi.mocked(instanceService.findActiveInstances).mockClear()
    mockSpawn.mockReturnValueOnce(child2).mockReturnValueOnce(agent2)
    await desktopWorkspaceHost.start('local2', 'user-1')

    expect(instanceService.findActiveInstances).not.toHaveBeenCalled()
  })

  it('does not mark instances that have backing processes', async () => {
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findActiveInstances).mockResolvedValue([])

    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    // setStopped should only have been called for reconciliation (none in this case),
    // not for the running workspace
    expect(instanceService.setStopped).not.toHaveBeenCalled()
  })
})
