import { describe, it, expect, vi, beforeEach } from 'vitest'

class FakeNextRequest {
  nextUrl: URL
  constructor(url: string) {
    this.nextUrl = new URL(url)
  }
}

vi.mock('next/server', () => ({
  NextRequest: FakeNextRequest,
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
      const res = new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: init?.headers,
      })
      return res
    },
  },
}))

const mockHealthService = {
  pingDatabase: vi.fn(),
  checkContainerProxy: vi.fn(),
}

vi.mock('@/lib/services', () => ({
  healthService: mockHealthService,
}))

function makeRequest(url = 'http://localhost/api/health') {
  return new FakeNextRequest(url) as never
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ARCHE_GIT_SHA = 'abc123'
  })

  it('returns 503 with error status when database is down', async () => {
    mockHealthService.pingDatabase.mockResolvedValue(false)

    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toEqual({
      status: 'error',
      version: 'abc123',
      checks: { database: false },
    })
  })

  it('returns 200 with ok status for shallow check', async () => {
    mockHealthService.pingDatabase.mockResolvedValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      status: 'ok',
      version: 'abc123',
      checks: { database: true },
    })
    expect(mockHealthService.checkContainerProxy).not.toHaveBeenCalled()
  })

  it('returns 200 with ok status for deep check when all services are up', async () => {
    mockHealthService.pingDatabase.mockResolvedValue(true)
    mockHealthService.checkContainerProxy.mockResolvedValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest('http://localhost/api/health?deep=true'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      status: 'ok',
      version: 'abc123',
      checks: { database: true, containerProxy: true },
    })
  })

  it('returns 503 with degraded status when container proxy is down', async () => {
    mockHealthService.pingDatabase.mockResolvedValue(true)
    mockHealthService.checkContainerProxy.mockResolvedValue(false)

    const { GET } = await import('./route')
    const res = await GET(makeRequest('http://localhost/api/health?deep=true'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toEqual({
      status: 'degraded',
      version: 'abc123',
      checks: { database: true, containerProxy: false },
    })
  })

  it('returns dev version when ARCHE_GIT_SHA is not set', async () => {
    delete process.env.ARCHE_GIT_SHA
    mockHealthService.pingDatabase.mockResolvedValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.version).toBe('dev')
  })

  it('sets Cache-Control: no-store header', async () => {
    mockHealthService.pingDatabase.mockResolvedValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest())

    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('does not call checkContainerProxy when deep param is absent', async () => {
    mockHealthService.pingDatabase.mockResolvedValue(true)

    const { GET } = await import('./route')
    await GET(makeRequest('http://localhost/api/health?deep=false'))

    expect(mockHealthService.checkContainerProxy).not.toHaveBeenCalled()
  })
})
