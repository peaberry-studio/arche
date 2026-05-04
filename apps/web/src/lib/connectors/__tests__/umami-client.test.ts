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

  it('reuses the cached self-hosted login token across requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'cached-token' }), {
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ pageviews: 20 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const config = {
      authMethod: 'login' as const,
      baseUrl: 'https://analytics-cache.example.com/api',
      username: 'cache-user',
      password: 'secret',
    }

    await requestUmamiJson({
      config,
      path: 'websites/site-1/stats',
    })

    await requestUmamiJson({
      config,
      path: 'websites/site-1/pageviews',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [firstDataUrl, firstDataInit] = fetchMock.mock.calls[1] as [URL, RequestInit]
    expect(firstDataUrl.toString()).toBe('https://analytics-cache.example.com/api/websites/site-1/stats')
    expect(new Headers(firstDataInit.headers).get('authorization')).toBe('Bearer cached-token')

    const [secondDataUrl, secondDataInit] = fetchMock.mock.calls[2] as [URL, RequestInit]
    expect(secondDataUrl.toString()).toBe('https://analytics-cache.example.com/api/websites/site-1/pageviews')
    expect(new Headers(secondDataInit.headers).get('authorization')).toBe('Bearer cached-token')
  })

  it('refreshes a cached login token when Umami rejects it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'old-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'expired token' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'new-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, refreshed: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const config = {
      authMethod: 'login' as const,
      baseUrl: 'https://analytics-refresh.example.com/api',
      username: 'cache-user',
      password: 'secret',
    }

    await requestUmamiJson({ config, path: 'websites/site-1/stats' })
    const response = await requestUmamiJson({ config, path: 'websites/site-1/pageviews' })

    expect(response).toEqual({
      ok: true,
      data: { ok: true, refreshed: true },
      status: 200,
      headers: expect.any(Headers),
    })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const [, staleRequestInit] = fetchMock.mock.calls[2] as [URL, RequestInit]
    expect(new Headers(staleRequestInit.headers).get('authorization')).toBe('Bearer old-token')
    const [, refreshedRequestInit] = fetchMock.mock.calls[4] as [URL, RequestInit]
    expect(new Headers(refreshedRequestInit.headers).get('authorization')).toBe('Bearer new-token')
  })

  it('does not reuse a cached login token when the password changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'cached-token' }), {
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid credentials' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid credentials' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await requestUmamiJson({
      config: {
        authMethod: 'login',
        baseUrl: 'https://analytics-password.example.com/api',
        username: 'shared-user',
        password: 'first-secret',
      },
      path: 'websites/site-1/stats',
    })

    const response = await requestUmamiJson({
      config: {
        authMethod: 'login',
        baseUrl: 'https://analytics-password.example.com/api',
        username: 'shared-user',
        password: 'second-secret',
      },
      path: 'websites/site-1/pageviews',
    })

    expect(response).toEqual({
      ok: false,
      error: 'umami_request_failed',
      message: 'Umami authentication failed (401). Check the username and password.',
      status: 401,
      headers: expect.any(Headers),
      data: { message: 'Invalid credentials' },
      retryAfter: undefined,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [thirdUrl, thirdInit] = fetchMock.mock.calls[2] as [URL, RequestInit]
    expect(thirdUrl.toString()).toBe('https://analytics-password.example.com/api/auth/login')
    expect(JSON.parse(String(thirdInit.body))).toEqual({
      username: 'shared-user',
      password: 'second-secret',
    })
  })

  it('surfaces Retry-After from Umami rate limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '17',
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await requestUmamiJson({
      config: {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'api-key-123',
      },
      path: 'websites',
    })

    expect(response).toEqual({
      ok: false,
      error: 'umami_request_failed',
      message: 'Umami request failed (429): Too many requests',
      status: 429,
      headers: expect.any(Headers),
      data: { message: 'Too many requests' },
      retryAfter: 17,
    })
  })

  it('surfaces text error payloads when Umami does not return JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Gateway down', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await requestUmamiJson({
      config: {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'api-key-123',
      },
      path: 'websites',
    })

    expect(response).toEqual({
      ok: false,
      error: 'umami_request_failed',
      message: 'Umami request failed (500): Gateway down',
      status: 500,
      headers: expect.any(Headers),
      data: 'Gateway down',
      retryAfter: undefined,
    })
  })

  it('returns null data for successful no-content responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await requestUmamiJson({
      config: {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'api-key-123',
      },
      path: 'websites/site-1',
      method: 'POST',
      body: { name: 'Site' },
    })

    expect(response).toEqual({
      ok: true,
      data: null,
      status: 204,
      headers: expect.any(Headers),
    })
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ name: 'Site' }))
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

  it('rejects invalid public endpoint values before any request is sent', async () => {
    ssrfMocks.validateConnectorTestEndpoint.mockResolvedValue({
      ok: false,
      error: 'invalid_endpoint',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await testUmamiConnection({
      authMethod: 'api-key',
      baseUrl: 'not-a-url',
      apiKey: 'api-key-123',
    })

    expect(response).toEqual({
      ok: false,
      error: 'invalid_endpoint',
      message: 'Umami base URL must be a valid public HTTPS URL.',
      status: 400,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an auth error when login succeeds without an access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: 'admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await requestUmamiJson({
      config: {
        authMethod: 'login',
        baseUrl: 'https://analytics-no-token.example.com/api',
        username: 'admin',
        password: 'secret',
      },
      path: 'websites',
    })

    expect(response).toEqual({
      ok: false,
      error: 'umami_auth_failed',
      message: 'Umami login succeeded without returning an access token.',
      status: 502,
      headers: expect.any(Headers),
      data: { user: 'admin' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
