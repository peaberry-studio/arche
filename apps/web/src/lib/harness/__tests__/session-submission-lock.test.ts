import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withSessionSubmissionLock } from '@/lib/harness/session-submission-lock'

const mocks = vi.hoisted(() => ({ desktop: false, query: vi.fn(), transaction: vi.fn(), vault: '/tmp/vault-a' }))
vi.mock('node:fs', () => ({ realpathSync: (path: string) => path }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => mocks.desktop }))
vi.mock('@/lib/runtime/desktop/context-store', () => ({ getDesktopVaultRuntimeContext: () => ({ vaultRoot: mocks.vault }) }))

describe('session submission admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.desktop = false
    mocks.vault = '/tmp/vault-a'
    mocks.transaction.mockImplementation((work) => work({ $queryRaw: mocks.query }))
    mocks.query.mockResolvedValue([{ locked: true }])
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('holds a PostgreSQL transaction lock throughout submission with a bounded operation signal', async () => {
    const submit = vi.fn(async ({ signal }: { signal?: AbortSignal }) => ({ ok: true as const, data: signal?.aborted }))
    expect(await withSessionSubmissionLock('alice', 'session', undefined, submit)).toEqual({ ok: true, data: false })
    expect(mocks.query.mock.calls[0][0].join('')).toContain('pg_try_advisory_xact_lock(hashtextextended(')
    expect(mocks.query.mock.calls[0][1]).toBe(JSON.stringify(['harness-prompt', 'alice', 'session']))
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 65_000 })
  })

  it('refuses a lock held by another process before performing runtime mutations', async () => {
    mocks.query.mockResolvedValue([{ locked: false }])
    const submit = vi.fn()
    expect(await withSessionSubmissionLock('alice', 'session', undefined, submit)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(submit).not.toHaveBeenCalled()
  })

  it('starts the operation deadline before acquiring the database lock and refuses expired work', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    mocks.query.mockImplementation(async () => {
      expect(timeout).toHaveBeenCalledWith(60_000)
      controller.abort(new Error('submission_deadline'))
      return [{ locked: true }]
    })
    const submit = vi.fn()
    await expect(withSessionSubmissionLock('alice', 'session', undefined, submit)).rejects.toThrow('submission_deadline')
    expect(submit).not.toHaveBeenCalled()
  })

  it('cancels in-flight runtime work if the transaction ends before it completes', async () => {
    const started = Promise.withResolvers<void>()
    let operationSignal: AbortSignal | undefined
    let pendingWork: Promise<unknown> = Promise.resolve()
    mocks.transaction.mockImplementation(async (work) => {
      pendingWork = work({ $queryRaw: mocks.query })
      await started.promise
      throw new Error('transaction_lost')
    })
    const submission = withSessionSubmissionLock('alice', 'session', undefined, async ({ signal }) => {
      operationSignal = signal
      started.resolve()
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      return { ok: true, data: undefined }
    })
    await expect(submission).rejects.toThrow('transaction_lost')
    expect(operationSignal?.aborted).toBe(true)
    await pendingWork
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
