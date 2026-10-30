import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_LOCK_CONNECTIONS, withRuntimeOperationLock } from '@/lib/harness/operation-lock'

const mocks = vi.hoisted(() => ({
  desktop: false,
  owners: new Map<string, object>(),
  open: 0,
  peakOpen: 0,
}))
vi.mock('pg', () => ({ Client: class {
  connect = vi.fn(async () => {
    mocks.open++
    mocks.peakOpen = Math.max(mocks.peakOpen, mocks.open)
  })
  query = vi.fn(async (_sql: string, [key]: string[]) => {
    const locked = !mocks.owners.has(key)
    if (locked) mocks.owners.set(key, this)
    return { rows: [{ locked }] }
  })
  end = vi.fn(async () => {
    mocks.open--
    for (const [key, owner] of mocks.owners) if (owner === this) mocks.owners.delete(key)
  })
  on = vi.fn()
} }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => mocks.desktop }))
vi.mock('@/lib/runtime/desktop/context-store', () => ({ getDesktopVaultRuntimeContext: () => ({ vaultRoot: '/' }) }))

const ok = { ok: true as const, data: undefined }

function hold(key: string, options?: { waitMs?: number }) {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const done = withRuntimeOperationLock(key, async () => {
    started.resolve()
    await release.promise
    return ok
  }, options)
  return { started: started.promise, release: () => release.resolve(), done }
}

describe('runtime operation lock', () => {
  beforeEach(() => {
    mocks.desktop = false
    mocks.owners.clear()
    mocks.open = 0
    mocks.peakOpen = 0
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test')
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

  it('never opens more lock connections than the process cap, and lets a waiter in once one frees', async () => {
    const holders = Array.from({ length: MAX_LOCK_CONNECTIONS }, (_, index) => hold(`key-${index}`))
    await Promise.all(holders.map((holder) => holder.started))
    const waiting = hold('one-more')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.open).toBe(MAX_LOCK_CONNECTIONS)

    holders[0].release()
    await waiting.started
    expect(mocks.peakOpen).toBe(MAX_LOCK_CONNECTIONS)

    waiting.release()
    for (const holder of holders.slice(1)) holder.release()
    await Promise.all([waiting.done, ...holders.map((holder) => holder.done)])
    expect(mocks.open).toBe(0)
  })

  it('reports exhausted capacity as a typed busy result instead of opening another connection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const holders = Array.from({ length: MAX_LOCK_CONNECTIONS }, (_, index) => hold(`key-${index}`))
    await vi.advanceTimersByTimeAsync(0)
    const refused = withRuntimeOperationLock('one-more', async () => ok)
    await vi.advanceTimersByTimeAsync(5_001)
    await expect(refused).resolves.toEqual({ ok: false, error: { code: 'session_busy', detail: 'runtime_lock_capacity' } })
    expect(mocks.peakOpen).toBe(MAX_LOCK_CONNECTIONS)
    for (const holder of holders) holder.release()
    await Promise.all(holders.map((holder) => holder.done))
  })

  it('refuses a held key at once by default but waits for it within a bounded wait', async () => {
    const first = hold('shared')
    await first.started
    await expect(withRuntimeOperationLock('shared', async () => ok)).resolves.toEqual({ ok: false, error: { code: 'session_busy' } })

    const work = vi.fn(async () => ok)
    const waiting = withRuntimeOperationLock('shared', work, { waitMs: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(work).not.toHaveBeenCalled()
    first.release()
    await expect(waiting).resolves.toEqual(ok)
    expect(work).toHaveBeenCalledOnce()
  })

  it('waits on a key held by another process and gives up after the bounded wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    mocks.owners.set('remote', {})
    const work = vi.fn(async () => ok)
    const waiting = withRuntimeOperationLock('remote', work, { waitMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_250)
    await expect(waiting).resolves.toEqual({ ok: false, error: { code: 'session_busy' } })
    expect(work).not.toHaveBeenCalled()
    expect(mocks.open).toBe(0)

    const acquired = withRuntimeOperationLock('remote', work, { waitMs: 1_000 })
    await vi.advanceTimersByTimeAsync(300)
    mocks.owners.delete('remote')
    await vi.advanceTimersByTimeAsync(300)
    await expect(acquired).resolves.toEqual(ok)
    expect(work).toHaveBeenCalledOnce()
  })

  it('keeps desktop locking in-process with the same bounded wait', async () => {
    mocks.desktop = true
    const first = hold('desktop-key')
    await first.started
    await expect(withRuntimeOperationLock('desktop-key', async () => ok)).resolves.toEqual({ ok: false, error: { code: 'session_busy' } })
    const waiting = withRuntimeOperationLock('desktop-key', async () => ok, { waitMs: 5_000 })
    first.release()
    await expect(waiting).resolves.toEqual(ok)
    expect(mocks.peakOpen).toBe(0)
  })
})
