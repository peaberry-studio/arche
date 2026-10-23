import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkHealth, createInstanceClient, normalizeOpenCodeError } from '@/lib/harness/adapters/opencode-v2/client'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/harness/runtime-connection', () => ({
  getInstanceBasicAuth: auth,
  getInstanceUrl: (_slug: string, baseUrl?: string) => baseUrl ?? 'http://runtime',
}))

describe('V2 client', () => {
  // The first import of the ESM client is slow; keep it out of the fake-timer tests.
  beforeAll(async () => { await import('@opencode/client') })
  beforeEach(() => {
    auth.mockResolvedValue({ baseUrl: 'http://runtime', authHeader: 'Basic test' })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

  it('uses the matched V2 API with workspace authentication', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ version: '2.0.32', pid: 1, urls: [] }))
    vi.stubGlobal('fetch', fetch)
    expect(await checkHealth('alice')).toEqual({ ok: true, data: { version: '2.0.32' } })
    expect(String(fetch.mock.calls[0][0])).toBe('http://runtime/api/info')
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Basic test')
  })

  it('uses explicit startup credentials instead of a running-instance lookup', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ version: '2.0.32', pid: 1, urls: [] }))
    vi.stubGlobal('fetch', fetch)
    expect((await checkHealth('alice', { password: 'test', baseUrl: 'http://direct' })).ok).toBe(true)
    expect(String(fetch.mock.calls[0][0])).toBe('http://direct/api/info')
    expect(auth).not.toHaveBeenCalled()
  })

  it('aborts a health request at its deadline', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal ?? undefined
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }))
    const pending = checkHealth('alice', { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    expect(await pending).toEqual({ ok: false, error: { code: 'healthcheck_timeout' } })
    expect(signal?.aborted).toBe(true)
  })

  it('keeps client construction out of the health deadline', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ version: '2.0.32', pid: 1, urls: [] }))
    vi.stubGlobal('fetch', fetch)
    vi.resetModules()
    vi.doMock('@opencode/client', async (importOriginal) => {
      await new Promise((resolve) => setTimeout(resolve, 150))
      return await importOriginal<typeof import('@opencode/client')>()
    })
    try {
      const { checkHealth: slowLoadCheckHealth } = await import('@/lib/harness/adapters/opencode-v2/client')
      expect(await slowLoadCheckHealth('alice', { timeoutMs: 50 })).toEqual({ ok: true, data: { version: '2.0.32' } })
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.doUnmock('@opencode/client')
      vi.resetModules()
    }
  })

  it('skips the client entirely when the caller signal is already aborted', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await checkHealth('alice', { signal: AbortSignal.abort() })).toEqual({ ok: false, error: { code: 'healthcheck_timeout' } })
    expect(auth).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propagates losing-probe cancellation', async () => {
    const controller = new AbortController()
    const fetch = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const pending = checkHealth('alice', { signal: controller.signal })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    controller.abort()
    expect(await pending).toEqual({ ok: false, error: { code: 'healthcheck_timeout' } })
  })

  it('does not mistake V1 or a TCP listener for V2 readiness', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: '1.18.18', healthy: true })))
    expect((await checkHealth('alice')).ok).toBe(false)
  })

  it('returns unavailable when there is no running connection', async () => {
    auth.mockResolvedValue(null)
    expect(await createInstanceClient('alice')).toBeNull()
  })

  it('preserves unexpected HTTP status without misclassifying a permission as a missing session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    expect(await checkHealth('alice')).toMatchObject({ ok: false, error: { code: 'http_status_503', status: 503 } })
  })

  it('decodes the recorded missing-session error but not unrelated 404s', () => {
    expect(normalizeOpenCodeError({ _tag: 'SessionNotFoundError', sessionID: 'missing', name: 'SessionNotFoundError' }).error.code).toBe('session_not_found')
    expect(normalizeOpenCodeError({ _tag: 'PermissionNotFoundError', status: 404 }).error.code).toBe('runtime_error')
  })
})
