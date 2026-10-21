import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetInstanceUrl = vi.fn()

vi.mock('@/lib/harness/runtime-connection', () => ({
  DEFAULT_HEALTH_TIMEOUT_MS: 5_000,
  getInstanceUrl: (slug: string, override?: string) => mockGetInstanceUrl(slug, override),
}))

describe('isInstanceHealthyWithPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns detailed failure when fetch fails', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const result = await isInstanceHealthyWithPassword('alice', 'test-password')

    expect(result).toEqual({ ok: false, detail: 'fetch_failed', message: 'Network error' })
    vi.unstubAllGlobals()
  })

  it('extracts DNS resolution failures from fetch causes', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const result = await isInstanceHealthyWithPassword('alice', 'test-password')

    expect(result).toEqual({ ok: false, detail: 'dns_resolution_error', message: 'fetch failed' })
    vi.unstubAllGlobals()
  })

  it('returns detailed failure when response is not ok', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const result = await isInstanceHealthyWithPassword('alice', 'test-password')

    expect(result).toEqual({ ok: false, detail: 'http_status_404' })
    vi.unstubAllGlobals()
  })

  it('returns detailed failure when response json does not have healthy=true', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    ))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const result = await isInstanceHealthyWithPassword('alice', 'test-password')

    expect(result).toEqual({ ok: false, detail: 'unhealthy_response', message: JSON.stringify({ status: 'ok' }) })
    vi.unstubAllGlobals()
  })

  it('returns detailed failure when response json parsing throws', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    ))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const result = await isInstanceHealthyWithPassword('alice', 'test-password')

    expect(result).toMatchObject({ ok: false, detail: 'invalid_json' })
    vi.unstubAllGlobals()
  })

  it('returns true when health endpoint reports healthy', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ healthy: true }), { status: 200 }),
    ))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const result = await isInstanceHealthyWithPassword('alice', 'test-password')

    expect(result).toEqual({ ok: true })
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchCall[0]).toBe('http://opencode-alice:4096/global/health')
    expect(fetchCall[1]).toMatchObject({
      headers: {
        Authorization: `Basic ${Buffer.from('opencode:test-password').toString('base64')}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    vi.unstubAllGlobals()
  })

  it('uses override base URL for direct container healthchecks', async () => {
    mockGetInstanceUrl.mockReturnValue('http://10.88.0.12:4096')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ healthy: true }), { status: 200 }),
    ))

    const { isInstanceHealthyWithPassword } = await import('../client')
    await isInstanceHealthyWithPassword('alice', 'test-password', 'http://10.88.0.12:4096')

    expect(mockGetInstanceUrl).toHaveBeenCalledWith('alice', 'http://10.88.0.12:4096')
    vi.unstubAllGlobals()
  })

  it('aborts a never-resolving fetch at the per-request deadline', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    let fetchInit: RequestInit | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      fetchInit = init
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const result = await isInstanceHealthyWithPassword('alice', 'test-password', undefined, { timeoutMs: 30 })

    expect(result).toEqual({ ok: false, detail: 'healthcheck_timeout' })
    expect(fetchInit?.signal).toBeDefined()
    vi.unstubAllGlobals()
  })

  it('returns healthcheck_timeout when an external signal cancels the request', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }))

    const { isInstanceHealthyWithPassword } = await import('../client')
    const promise = isInstanceHealthyWithPassword('alice', 'test-password', undefined, {
      timeoutMs: 1_000,
      signal: controller.signal,
    })
    controller.abort()

    await expect(promise).resolves.toEqual({ ok: false, detail: 'healthcheck_timeout' })
    vi.unstubAllGlobals()
  })

  it('honors an already aborted external health signal', async () => {
    mockGetInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true)
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    }))
    try {
      const { isInstanceHealthyWithPassword } = await import('@/lib/harness/adapters/opencode-v1/client')
      await expect(isInstanceHealthyWithPassword('alice', 'test-password', undefined, { signal: controller.signal })).resolves.toEqual({ ok: false, detail: 'healthcheck_timeout' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
