import { EventEmitter } from 'events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn(), health: vi.fn(), export: vi.fn(), runtime: vi.fn(),
}))

vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('fs/promises', () => ({ mkdtemp: mocks.mkdtemp, rm: mocks.rm }))
vi.mock('@/lib/runtime/desktop/config', () => ({
  createSafeEnv: () => ({ PATH: '/bin' }), DEFAULT_USERNAME: 'opencode', LOOPBACK_HOST: '127.0.0.1',
  getOpencodeBinary: () => '/bundle/opencode-v1', makeAuthHeader: () => 'fixture-auth',
}))
vi.mock('@/lib/harness/legacy-session-archive', () => ({ exportLegacySessions: mocks.export }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForKind: mocks.runtime }))

import { archiveDesktopLegacySessions, cleanupDesktopLegacyArchive } from '@/lib/runtime/desktop/legacy-archive'

const input = {
  slug: 'alice', workspaceDir: '/vault/workspace', dataDir: '/vault/.runtime/opencode',
  port: 4096, password: 'pw', timeoutMs: 100, intervalMs: 1,
}

function makeChild() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn((_signal: string) => {
      queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null) })
      return true
    }),
  })
  return child
}

describe('archiveDesktopLegacySessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mkdtemp.mockResolvedValue('/vault/.runtime/opencode/.archive-config-fixture')
    mocks.rm.mockResolvedValue(undefined)
    mocks.health.mockResolvedValue({ ok: true, data: {} })
    mocks.export.mockResolvedValue({ ok: true, data: { archived: 2 } })
    mocks.runtime.mockReturnValue({ ok: true, data: { kind: 'opencode-v1', slug: 'alice', health: mocks.health } })
  })

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('exports through an explicit bounded V1 connection, isolates config and confirms helper exit', async () => {
    const child = makeChild()
    mocks.spawn.mockReturnValue(child)
    await expect(archiveDesktopLegacySessions(input)).resolves.toEqual({ ok: true, data: { archived: 2 } })
    expect(mocks.spawn).toHaveBeenCalledWith('/bundle/opencode-v1', ['serve', '--hostname', '127.0.0.1', '--port', '4096'], expect.objectContaining({
      cwd: '/vault/workspace', stdio: 'ignore',
      env: {
        PATH: '/bin', HOME: input.dataDir,
        XDG_DATA_HOME: `${input.dataDir}/.local/share`, XDG_STATE_HOME: `${input.dataDir}/.local/state`,
        XDG_CONFIG_HOME: `${input.dataDir}/.archive-config-fixture`,
        OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: 'pw',
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true',
        OPENCODE_CONFIG_CONTENT: '{"mcp":{},"plugin":[],"enabled_providers":[]}',
      },
    }))
    expect(mocks.runtime).toHaveBeenCalledWith('alice', 'opencode-v1', {
      baseUrl: 'http://127.0.0.1:4096', authHeader: 'fixture-auth', signal: expect.any(AbortSignal),
    })
    expect(mocks.export).toHaveBeenCalledWith('alice', expect.objectContaining({ kind: 'opencode-v1' }))
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(mocks.rm).toHaveBeenCalledWith(`${input.dataDir}/.archive-config-fixture`, { recursive: true, force: true })
    expect(child.exitCode).toBe(0)
  })

  it('preserves an export failure for the caller to fall back after cleanup', async () => {
    mocks.spawn.mockReturnValue(makeChild())
    mocks.export.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    await expect(archiveDesktopLegacySessions(input)).resolves.toEqual({ ok: false, error: { code: 'runtime_error' } })
    expect(mocks.rm).toHaveBeenCalled()
  })

  it('returns a typed error when the legacy executable cannot start', async () => {
    const child = makeChild()
    mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.emit('error', new Error('ENOENT'))); return child })
    mocks.health.mockResolvedValue({ ok: false, error: { code: 'connection_refused' } })
    await expect(archiveDesktopLegacySessions(input)).resolves.toMatchObject({ ok: false, error: { code: 'runtime_error' } })
    expect(mocks.export).not.toHaveBeenCalled()
  })

  it('stops readiness probing and cleans up when the bounded connection expires', async () => {
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    mocks.spawn.mockReturnValue(makeChild())
    mocks.health.mockImplementation(async () => {
      controller.abort()
      return { ok: false, error: { code: 'healthcheck_timeout' } }
    })
    await expect(archiveDesktopLegacySessions(input)).resolves.toMatchObject({ ok: false, error: { code: 'runtime_error' } })
    expect(mocks.health).toHaveBeenCalledTimes(1)
    expect(mocks.export).not.toHaveBeenCalled()
    expect(mocks.rm).toHaveBeenCalled()
  })

  it('escalates to SIGKILL and refuses fallback until exit is confirmed', async () => {
    vi.useFakeTimers()
    const child = makeChild()
    child.kill.mockImplementation(() => true)
    mocks.spawn.mockReturnValue(child)
    const pending = archiveDesktopLegacySessions(input)
    const rejected = expect(pending).rejects.toThrow('desktop_legacy_archive_cleanup_unconfirmed')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
    expect(mocks.rm).not.toHaveBeenCalled()

    const retry = archiveDesktopLegacySessions(input)
    const retryRejected = expect(retry).rejects.toThrow('desktop_legacy_archive_cleanup_unconfirmed')
    await vi.advanceTimersByTimeAsync(10_000)
    await retryRejected
    expect(mocks.spawn).toHaveBeenCalledTimes(1)

    child.exitCode = 0
    await cleanupDesktopLegacyArchive(input.dataDir)
    expect(mocks.rm).toHaveBeenCalledTimes(1)
  })
})
