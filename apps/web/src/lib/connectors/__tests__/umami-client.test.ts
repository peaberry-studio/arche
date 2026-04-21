import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestUmamiJson, testUmamiConnection } from '@/lib/connectors/umami'

const ssrfMocks = vi.hoisted(() => ({
  validateConnectorTestEndpoint: vi.fn(),
}))

vi.mock('@/lib/security/ssrf', () => ({
  validateConnectorTestEndpoint: ssrfMocks.validateConnectorTestEndpoint,
}))

describe('umami-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ssrfMocks.validateConnectorTestEndpoint.mockImplementation(async (value: string) => ({
      ok: true,
      url: new URL(value),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the Umami Cloud API key header for direct requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await requestUmamiJson({
      config: {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'api-key-123',
      },
      path: 'websites',
      searchParams: new URLSearchParams({ pageSize: '1' }),
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://api.umami.is/v1/websites?pageSize=1')
    expect(new Headers(init.headers).get('x-umami-api-key')).toBe('api-key-123')
  })

  it('logs in for self-hosted credentials before making the API request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'login-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ pageviews: 10 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await requestUmamiJson({
      config: {
        authMethod: 'login',
        baseUrl: 'https://analytics.example.com/api',
        username: 'admin',
        password: 'secret',
      },
      path: 'websites/site-1/stats',
    })

    const [loginUrl, loginInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(loginUrl.toString()).toBe('https://analytics.example.com/api/auth/login')
    expect(JSON.parse(String(loginInit.body))).toEqual({ username: 'admin', password: 'secret' })

    const [requestUrl, requestInit] = fetchMock.mock.calls[1] as [URL, RequestInit]
    expect(requestUrl.toString()).toBe('https://analytics.example.com/api/websites/site-1/stats')
    expect(new Headers(requestInit.headers).get('authorization')).toBe('Bearer login-token')
  })

  it('blocks private or invalid endpoints before any request is sent', async () => {
    ssrfMocks.validateConnectorTestEndpoint.mockResolvedValue({
      ok: false,
      error: 'blocked_endpoint',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await testUmamiConnection({
      authMethod: 'api-key',
      baseUrl: 'https://analytics.internal/api',
      apiKey: 'api-key-123',
    })

    expect(response).toEqual({
      ok: false,
      error: 'blocked_endpoint',
      message: 'Umami base URL is blocked for security reasons.',
      status: 400,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
