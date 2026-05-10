import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateConfiguredOpencodeClient = vi.fn()
const mockResolveInstanceConnection = vi.fn()
const mockGetInstanceUrl = vi.fn()

vi.mock('@/lib/opencode/client-factory', () => ({
  createConfiguredOpencodeClient: (...args: unknown[]) => mockCreateConfiguredOpencodeClient(...args),
}))

vi.mock('@/lib/opencode/connection-resolver', () => ({
  getInstanceUrl: (slug: string, override?: string) => mockGetInstanceUrl(slug, override),
  resolveInstanceConnection: (slug: string, override?: string) => mockResolveInstanceConnection(slug, override),
}))

describe('createInstanceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when resolveInstanceConnection returns null', async () => {
    mockResolveInstanceConnection.mockResolvedValue(null)

    const { createInstanceClient } = await import('../client')
    const result = await createInstanceClient('alice')

    expect(result).toBeNull()
    expect(mockCreateConfiguredOpencodeClient).not.toHaveBeenCalled()
  })

  it('creates and returns a client when connection is resolved', async () => {
    const connection = { baseUrl: 'http://opencode-alice:4096', authHeader: 'Basic abc', username: 'opencode', password: 'pw' }
    mockResolveInstanceConnection.mockResolvedValue(connection)
    const mockClient = { global: { health: vi.fn() } }
    mockCreateConfiguredOpencodeClient.mockReturnValue(mockClient)

    const { createInstanceClient } = await import('../client')
    const result = await createInstanceClient('alice')

    expect(result).toBe(mockClient)
    expect(mockCreateConfiguredOpencodeClient).toHaveBeenCalledWith(connection)
  })
})

describe('isInstanceHealthy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when client creation fails', async () => {
    mockResolveInstanceConnection.mockResolvedValue(null)

    const { isInstanceHealthy } = await import('../client')
    const result = await isInstanceHealthy('alice')

    expect(result).toBe(false)
  })

  it('returns true when health check reports healthy', async () => {
    const connection = { baseUrl: 'http://opencode-alice:4096', authHeader: 'Basic abc', username: 'opencode', password: 'pw' }
    mockResolveInstanceConnection.mockResolvedValue(connection)
    const mockClient = { global: { health: vi.fn().mockResolvedValue({ data: { healthy: true } }) } }
    mockCreateConfiguredOpencodeClient.mockReturnValue(mockClient)

    const { isInstanceHealthy } = await import('../client')
    const result = await isInstanceHealthy('alice')

    expect(result).toBe(true)
    expect(mockClient.global.health).toHaveBeenCalled()
  })

  it('returns false when health check response does not have healthy=true', async () => {
    const connection = { baseUrl: 'http://opencode-alice:4096', authHeader: 'Basic abc', username: 'opencode', password: 'pw' }
    mockResolveInstanceConnection.mockResolvedValue(connection)
    const mockClient = { global: { health: vi.fn().mockResolvedValue({ data: { healthy: false } }) } }
    mockCreateConfiguredOpencodeClient.mockReturnValue(mockClient)

    const { isInstanceHealthy } = await import('../client')
    const result = await isInstanceHealthy('alice')

    expect(result).toBe(false)
  })

  it('returns false when health check throws', async () => {
    const connection = { baseUrl: 'http://opencode-alice:4096', authHeader: 'Basic abc', username: 'opencode', password: 'pw' }
    mockResolveInstanceConnection.mockResolvedValue(connection)
    const mockClient = { global: { health: vi.fn().mockRejectedValue(new Error('timeout')) } }
    mockCreateConfiguredOpencodeClient.mockReturnValue(mockClient)

    const { isInstanceHealthy } = await import('../client')
    const result = await isInstanceHealthy('alice')

    expect(result).toBe(false)
  })
})

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
})
