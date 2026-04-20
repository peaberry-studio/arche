import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeNextRequest {
  headers: Headers

  constructor(public readonly nextUrl: URL, headers?: HeadersInit) {
    this.headers = new Headers(headers)
  }
}

vi.mock('next/server', () => ({
  NextRequest: FakeNextRequest,
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: init?.headers,
      })
    },
  },
}))

const mockValidateDesktopToken = vi.fn<(token: string | null) => boolean>()

vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: (token: string | null) => mockValidateDesktopToken(token),
}))

function makeRequest(headers?: HeadersInit) {
  return new FakeNextRequest(new URL('http://localhost/api/internal/desktop/runtime'), headers) as never
}

describe('GET /api/internal/desktop/runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ARCHE_RELEASE_VERSION = '1.2.3'
    process.env.ARCHE_GIT_SHA = 'abc123'
  })

  it('returns 401 when the desktop token is missing or invalid', async () => {
    mockValidateDesktopToken.mockReturnValue(false)

    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'unauthorized' })
    expect(mockValidateDesktopToken).toHaveBeenCalledWith(null)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns the desktop runtime identity when the token is valid', async () => {
    mockValidateDesktopToken.mockReturnValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest({ 'x-arche-desktop-token': 'valid-token' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      app: 'arche',
      runtime: 'desktop',
      status: 'ok',
      version: '1.2.3',
    })
    expect(mockValidateDesktopToken).toHaveBeenCalledWith('valid-token')
  })

  it('falls back to git sha when the release version is absent', async () => {
    delete process.env.ARCHE_RELEASE_VERSION
    mockValidateDesktopToken.mockReturnValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest({ 'x-arche-desktop-token': 'valid-token' }))
    const body = await res.json()

    expect(body.version).toBe('abc123')
  })

  it('falls back to git sha when the release version is empty', async () => {
    process.env.ARCHE_RELEASE_VERSION = '   '
    mockValidateDesktopToken.mockReturnValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest({ 'x-arche-desktop-token': 'valid-token' }))
    const body = await res.json()

    expect(body.version).toBe('abc123')
  })

  it('falls back to dev when no version metadata is available', async () => {
    delete process.env.ARCHE_RELEASE_VERSION
    delete process.env.ARCHE_GIT_SHA
    mockValidateDesktopToken.mockReturnValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest({ 'x-arche-desktop-token': 'valid-token' }))
    const body = await res.json()

    expect(body.version).toBe('dev')
  })
})
