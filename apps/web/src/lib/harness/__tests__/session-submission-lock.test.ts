import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withSessionSubmissionLock } from '@/lib/harness/session-submission-lock'

const mocks = vi.hoisted(() => ({
  desktop: false, query: vi.fn(), transaction: vi.fn(), vault: '/tmp/vault-a',
  client: vi.fn(), connect: vi.fn(), owners: new Map<string, object>(),
  connections: [] as { lose: () => void; end: ReturnType<typeof vi.fn> }[],
}))
vi.mock('pg', () => ({ Client: class {
  private onError?: (error: Error) => void
  connect = vi.fn(() => mocks.connect())
  query = vi.fn(async (sql: string, [key]: string[]) => {
    expect(sql).toBe('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked')
    const locked = !mocks.owners.has(key)
    if (locked) mocks.owners.set(key, this)
    return { rows: [{ locked }] }
  })
  end = vi.fn(async () => {
    for (const [key, owner] of mocks.owners) if (owner === this) mocks.owners.delete(key)
  })
  on(_event: string, callback: (error: Error) => void) { this.onError = callback }
  constructor(config: object) {
    mocks.client(config)
    mocks.connections.push({ end: this.end, lose: () => { void this.end(); this.onError?.(new Error('lock_lost')) } })
  }
} }))
vi.mock('node:fs', () => ({ realpathSync: (path: string) => path }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => mocks.desktop }))
vi.mock('@/lib/runtime/desktop/context-store', () => ({ getDesktopVaultRuntimeContext: () => ({ vaultRoot: mocks.vault }) }))

describe('session submission admission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.desktop = false
    mocks.vault = '/tmp/vault-a'
    mocks.owners.clear()
    mocks.connections.length = 0
    mocks.connect.mockResolvedValue(undefined)
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test')
    mocks.transaction.mockImplementation((work) => work({ $queryRaw: mocks.query }))
    mocks.query.mockResolvedValue([{ locked: true }])
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs() })

  it('keeps runtime I/O outside Prisma transactions with a bounded operation signal', async () => {
    const submit = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      expect(mocks.transaction).not.toHaveBeenCalled()
      return { ok: true as const, data: signal?.aborted }
    })
    expect(await withSessionSubmissionLock('alice', 'session', undefined, submit)).toEqual({ ok: true, data: false })
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ connectionTimeoutMillis: 5_000, query_timeout: 5_000 }))
    expect(mocks.connections[0].end).toHaveBeenCalledOnce()
  })

  it('refuses a lock held by another process before performing runtime mutations', async () => {
    mocks.query.mockResolvedValue([{ locked: false }])
    mocks.owners.set(JSON.stringify(['harness-prompt', 'alice', 'session']), {})
    const submit = vi.fn()
    expect(await withSessionSubmissionLock('alice', 'session', undefined, submit)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(submit).not.toHaveBeenCalled()
    expect(mocks.connections[0].end).toHaveBeenCalledOnce()
  })

  it('closes a failed lock connection without starting runtime work', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('database_unavailable'))
    const submit = vi.fn()
    await expect(withSessionSubmissionLock('alice', 'session', undefined, submit)).rejects.toThrow('database_unavailable')
    expect(submit).not.toHaveBeenCalled()
    expect(mocks.connections[0].end).toHaveBeenCalledOnce()
  })

  it('starts the operation deadline before acquiring the database lock and refuses expired work', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    mocks.client.mockImplementation(() => {
      expect(timeout).toHaveBeenCalledWith(60_000)
      controller.abort(new Error('submission_deadline'))
    })
    const submit = vi.fn()
    await expect(withSessionSubmissionLock('alice', 'session', undefined, submit)).rejects.toThrow('submission_deadline')
    expect(submit).not.toHaveBeenCalled()
  })

  it('cancels in-flight runtime work if the dedicated lock connection is lost', async () => {
    const started = Promise.withResolvers<void>()
    let operationSignal: AbortSignal | undefined
    const submission = withSessionSubmissionLock('alice', 'session', undefined, async ({ signal }) => {
      operationSignal = signal
      started.resolve()
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      return { ok: true, data: undefined }
    })
    await started.promise
    mocks.connections[0].lose()
    await expect(submission).rejects.toThrow('lock_lost')
    expect(operationSignal?.aborted).toBe(true)
    expect(mocks.connections[0].end).toHaveBeenCalled()
  })

  it('serializes independent callers for one session but admits different sessions and releases after failure', async () => {
    vi.resetModules()
    const other = await import('@/lib/harness/session-submission-lock')
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const first = withSessionSubmissionLock('alice', 'session', undefined, async () => {
      started.resolve()
      await release.promise
      throw new Error('submission_failed')
    })
    await started.promise
    const submit = vi.fn(async () => ({ ok: true as const, data: undefined }))
    expect(await other.withSessionSubmissionLock('alice', 'session', undefined, submit)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(submit).not.toHaveBeenCalled()
    expect(await other.withSessionSubmissionLock('alice', 'other-session', undefined, submit)).toEqual({ ok: true, data: undefined })
    release.resolve()
    await expect(first).rejects.toThrow('submission_failed')
    expect(await other.withSessionSubmissionLock('alice', 'session', undefined, submit)).toEqual({ ok: true, data: undefined })
    expect(mocks.owners.size).toBe(0)
  })

  it('keeps desktop admission shared between callers and releases it after an error', async () => {
    mocks.desktop = true
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const first = withSessionSubmissionLock('alice', 'session', undefined, async () => {
      started.resolve()
      await release.promise
      throw new Error('temporary failure')
    })
    await started.promise
    const submit = vi.fn(async () => ({ ok: true as const, data: undefined }))
    expect(await withSessionSubmissionLock('alice', 'session', undefined, submit)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(await withSessionSubmissionLock('alice', 'session', undefined, submit)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    release.resolve()
    await expect(first).rejects.toThrow('temporary failure')
    expect(await withSessionSubmissionLock('alice', 'session', undefined, submit)).toEqual({ ok: true, data: undefined })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('isolates desktop vaults with identical slugs and session ids', async () => {
    mocks.desktop = true
    const release = Promise.withResolvers<void>()
    const first = withSessionSubmissionLock('alice', 'session', undefined, async () => {
      await release.promise
      return { ok: true, data: undefined }
    })
    mocks.vault = '/tmp/vault-b'
    expect(await withSessionSubmissionLock('alice', 'session', undefined, async () => ({ ok: true, data: undefined }))).toEqual({ ok: true, data: undefined })
    release.resolve()
    await first
  })

  it('propagates caller cancellation into the bounded submission signal', async () => {
    const controller = new AbortController()
    await withSessionSubmissionLock('alice', 'session', { signal: controller.signal }, async ({ signal }) => {
      controller.abort()
      expect(signal?.aborted).toBe(true)
      return { ok: true, data: undefined }
    })
  })
})
