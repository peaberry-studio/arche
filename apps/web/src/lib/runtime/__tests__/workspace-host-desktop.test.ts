import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChildProcess } from 'child_process'

const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

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

describe('desktopWorkspaceHost', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts a workspace and returns started status', async () => {
    const child = makeChildProcess()
    mockSpawn.mockReturnValue(child)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(mockSpawn).toHaveBeenCalledOnce()
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
})
