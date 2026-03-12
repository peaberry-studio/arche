import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChildProcess } from 'child_process'

const mockSpawn = vi.fn()
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockWriteFileSync = vi.fn()

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    upsertStarting: vi.fn().mockResolvedValue(undefined),
    setRunning: vi.fn().mockResolvedValue(undefined),
    setStopped: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  encryptPassword: vi.fn((p: string) => `enc:${p}`),
}))

vi.mock('@/lib/opencode/providers', () => ({
  syncProviderAccessForInstance: vi.fn().mockResolvedValue({ ok: true }),
}))

const mockFetch = vi.fn()

function makeChildProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    killed: false,
    kill: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    ...overrides,
  } as unknown as ChildProcess
}

function mockHealthyFetch() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ healthy: true }),
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
    // @ts-expect-error -- reset for test isolation
    process.resourcesPath = undefined
    mockExistsSync.mockReturnValue(false)
    mockHealthyFetch()
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error -- restore for test isolation
    process.resourcesPath = originalResourcesPath
  })

  it('starts a workspace and returns started status', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(mockSpawn).toHaveBeenCalledOnce()
  })

  it('spawns opencode with serve command and correct args', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockSpawn).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--hostname', '127.0.0.1', '--port', '4096'],
      expect.objectContaining({
        stdio: 'pipe',
        detached: false,
      }),
    )
  })

  it('returns already_running when workspace is already started', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const result = await desktopWorkspaceHost.start('local', 'user-1')
    expect(result).toEqual({ ok: true, status: 'already_running' })
    expect(mockSpawn).toHaveBeenCalledOnce() // not called again
  })

  it('stops a running workspace', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const result = await desktopWorkspaceHost.stop('local', 'user-1')
    expect(result).toEqual({ ok: true, status: 'stopped' })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('stop returns already_stopped when no workspace is running', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.stop('local', 'user-1')
    expect(result).toEqual({ ok: true, status: 'already_stopped' })
  })

  it('returns running status with startedAt after start', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const status = await desktopWorkspaceHost.getStatus('local')
    expect(status).not.toBeNull()
    expect(status!.status).toBe('running')
    expect(status!.startedAt).toBeInstanceOf(Date)
    expect(status!.stoppedAt).toBeNull()
  })

  it('returns stopped status when no process exists', async () => {
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
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getConnection('local')
    expect(conn).not.toBeNull()
    expect(conn!.baseUrl).toBe('http://localhost:4096')
    expect(conn!.authHeader).toMatch(/^Basic /)
  })

  it('returns agent connection info for running workspace', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getAgentConnection('local')
    expect(conn).not.toBeNull()
    expect(conn!.baseUrl).toBe('http://localhost:4097')
  })

  it('returns null connection for stopped workspace', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    expect(await desktopWorkspaceHost.getConnection('local')).toBeNull()
    expect(await desktopWorkspaceHost.getAgentConnection('local')).toBeNull()
  })

  it('generates a valid Basic auth header', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getConnection('local')
    const decoded = Buffer.from(conn!.authHeader.replace('Basic ', ''), 'base64').toString()
    expect(decoded).toBe('opencode:arche-desktop')
  })

  it('syncs providers after health check', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const { syncProviderAccessForInstance } = await import('@/lib/opencode/providers')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(syncProviderAccessForInstance).toHaveBeenCalledWith({
      instance: {
        baseUrl: 'http://localhost:4096',
        authHeader: expect.stringMatching(/^Basic /),
      },
      slug: 'local',
      userId: 'user-1',
    })
  })

  it('stores instance credentials in DB on start', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)
    mockHealthyFetch()

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })

    const { instanceService } = await import('@/lib/services')
    expect(instanceService.upsertStarting).toHaveBeenCalledWith('local', expect.any(String))
  })
})

describe('getOpencodeBinary', () => {
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_OPENCODE_BIN
    // @ts-expect-error -- reset for test isolation
    process.resourcesPath = undefined
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error -- restore for test isolation
    process.resourcesPath = originalResourcesPath
    vi.restoreAllMocks()
  })

  it('returns ARCHE_OPENCODE_BIN env var when set', async () => {
    process.env.ARCHE_OPENCODE_BIN = '/custom/path/opencode'

    const { getOpencodeBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('/custom/path/opencode')
  })

  it('returns bundled binary path when running in packaged Electron', async () => {
    // @ts-expect-error -- simulating Electron packaged environment
    process.resourcesPath = '/Applications/Arche.app/Contents/Resources'
    mockExistsSync.mockReturnValue(true)

    const { getOpencodeBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe(
      '/Applications/Arche.app/Contents/Resources/bin/opencode',
    )
  })

  it('falls back to PATH lookup when not packaged', async () => {
    const { getOpencodeBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('opencode')
  })

  it('falls back to PATH when resourcesPath exists but binary does not', async () => {
    // @ts-expect-error -- simulating Electron environment
    process.resourcesPath = '/some/resources'
    mockExistsSync.mockReturnValue(false)

    const { getOpencodeBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('opencode')
  })
})
