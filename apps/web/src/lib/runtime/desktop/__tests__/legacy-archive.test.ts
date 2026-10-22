import { EventEmitter } from 'events'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(), cp: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn(), health: vi.fn(), export: vi.fn(), reader: vi.fn(),
}))

vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('fs/promises', () => ({ cp: mocks.cp, mkdtemp: mocks.mkdtemp, rm: mocks.rm }))
vi.mock('@/lib/runtime/desktop/config', () => ({
  createSafeEnv: () => ({ PATH: '/bin' }), DEFAULT_USERNAME: 'opencode', LOOPBACK_HOST: '127.0.0.1',
  getLegacyOpencodeBinary: () => '/bundle/opencode-v1', makeAuthHeader: () => 'fixture-auth',
}))
vi.mock('@/lib/harness/legacy-session-archive', () => ({ exportLegacySessions: mocks.export }))
vi.mock('@/lib/harness/registry', () => ({ getLegacySessionReader: mocks.reader }))

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
    mocks.mkdtemp.mockResolvedValue('/vault/.runtime/.opencode-archive-fixture')
    mocks.cp.mockResolvedValue(undefined)
    mocks.rm.mockResolvedValue(undefined)
    mocks.health.mockResolvedValue({ ok: true, data: {} })
    mocks.export.mockResolvedValue({ ok: true, data: { archived: 2 } })
    mocks.reader.mockReturnValue({ slug: 'alice', health: mocks.health })
  })

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('exports from a disposable copy outside the source and removes it only after helper exit', async () => {
    const child = makeChild()
    mocks.spawn.mockReturnValue(child)
    await expect(archiveDesktopLegacySessions(input)).resolves.toEqual({ ok: true, data: { archived: 2 } })
    expect(mocks.mkdtemp).toHaveBeenCalledWith('/vault/.runtime/.opencode-archive-')
    expect(mocks.cp).toHaveBeenCalledExactlyOnceWith(`${input.dataDir}/.local`, '/vault/.runtime/.opencode-archive-fixture/.local', { recursive: true, dereference: true })
    expect(mocks.cp.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[0])
    expect(mocks.spawn).toHaveBeenCalledWith('/bundle/opencode-v1', ['serve', '--hostname', '127.0.0.1', '--port', '4096'], expect.objectContaining({
      cwd: '/vault/workspace', stdio: 'ignore',
      env: {
        PATH: '/bin', HOME: '/vault/.runtime/.opencode-archive-fixture',
        XDG_DATA_HOME: '/vault/.runtime/.opencode-archive-fixture/.local/share', XDG_STATE_HOME: '/vault/.runtime/.opencode-archive-fixture/.local/state',
        XDG_CONFIG_HOME: '/vault/.runtime/.opencode-archive-fixture/config',
        OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: 'pw',
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true',
        OPENCODE_CONFIG_CONTENT: '{"mcp":{},"plugin":[],"enabled_providers":[]}',
      },
    }))
    expect(mocks.reader).toHaveBeenCalledWith('alice', {
      baseUrl: 'http://127.0.0.1:4096', authHeader: 'fixture-auth',
    })
    expect(mocks.export).toHaveBeenCalledWith('alice', expect.objectContaining({ slug: 'alice', health: mocks.health }))
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(mocks.rm).toHaveBeenCalledWith('/vault/.runtime/.opencode-archive-fixture', { recursive: true, force: true })
    expect(child.exitCode).toBe(0)
  })

  it('fails without starting a helper if copying the source fails, and cleans up the partial copy', async () => {
    mocks.cp.mockRejectedValueOnce(new Error('copy failed'))
    await expect(archiveDesktopLegacySessions(input)).resolves.toMatchObject({ ok: false, error: { code: 'runtime_error', detail: 'copy failed' } })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.export).not.toHaveBeenCalled()
    expect(mocks.rm).toHaveBeenCalledWith('/vault/.runtime/.opencode-archive-fixture', { recursive: true, force: true })
  })

  it.each([true, false])('preserves source files when the helper writes its copy (export success: %s)', async (success) => {
    const fs = await vi.importActual<typeof import('fs/promises')>('fs/promises')
    const root = await fs.mkdtemp(join(process.cwd(), '.desktop-archive-test-'))
    const dataDir = join(root, 'opencode')
    const files = ['.local/share/opencode/opencode.db', '.local/share/opencode/opencode.db-wal', '.local/share/opencode/opencode.db-shm', '.local/state/opencode/locks/fixture']
    const child = makeChild()
    try {
      for (const file of files) {
        const path = join(dataDir, file)
        await fs.mkdir(join(path, '..'), { recursive: true })
        await fs.writeFile(path, file)
      }
      const before = await Promise.all(files.map(async (file) => ({ file, content: await fs.readFile(join(dataDir, file), 'utf8'), mtime: (await fs.stat(join(dataDir, file))).mtimeMs })))
      const tree = await fs.readdir(dataDir, { recursive: true })
      mocks.mkdtemp.mockImplementationOnce(fs.mkdtemp)
      mocks.cp.mockImplementationOnce(fs.cp)
      mocks.spawn.mockReturnValue(child)
      mocks.rm.mockImplementationOnce(async (path, options) => {
        expect(child.exitCode).toBe(0)
        await fs.rm(path, options)
      })
      const result = success ? { ok: true, data: { archived: 2 } } : { ok: false, error: { code: 'runtime_error' } }
      mocks.export.mockImplementationOnce(async () => {
        const home = mocks.spawn.mock.calls.at(-1)?.[2].env.HOME
        expect(home).not.toBe(dataDir)
        for (const file of files) {
          expect(await fs.readFile(join(home, file), 'utf8')).toBe(file)
          await fs.writeFile(join(home, file), 'helper write')
        }
        return result
      })
      expect(await archiveDesktopLegacySessions({ ...input, dataDir })).toEqual(result)
      expect(await Promise.all(files.map(async (file) => ({ file, content: await fs.readFile(join(dataDir, file), 'utf8'), mtime: (await fs.stat(join(dataDir, file))).mtimeMs })))).toEqual(before)
      expect(await fs.readdir(dataDir, { recursive: true })).toEqual(tree)
      expect(await fs.readdir(root)).toEqual(['opencode'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns an export failure to the caller after cleanup', async () => {
    mocks.spawn.mockReturnValue(makeChild())
    mocks.export.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    await expect(archiveDesktopLegacySessions(input)).resolves.toEqual({ ok: false, error: { code: 'runtime_error' } })
    expect(mocks.rm).toHaveBeenCalled()
  })

  it('limits the startup deadline to readiness rather than a long history export', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), ms)
      return controller.signal
    })
    mocks.spawn.mockReturnValue(makeChild())
    mocks.export.mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(input.timeoutMs * 3)
      expect(mocks.reader.mock.calls.at(-1)?.[1].signal?.aborted ?? false).toBe(false)
      return { ok: true, data: { archived: 40 } }
    })
    expect(await archiveDesktopLegacySessions(input)).toEqual({ ok: true, data: { archived: 40 } })
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

  it('escalates to SIGKILL and refuses a new helper until exit is confirmed', async () => {
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
