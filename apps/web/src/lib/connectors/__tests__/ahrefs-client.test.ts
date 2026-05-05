import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestAhrefsJson, testAhrefsConnection } from '@/lib/connectors/ahrefs-client'

describe('ahrefs-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends requests with Bearer authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await requestAhrefsJson({
      config: { apiKey: 'test-key' },
      path: '/v3/site-explorer/metrics',
      searchParams: { target: 'example.com' },
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      Accept: 'application/json',
      'User-Agent': 'Arche Ahrefs Connector',
    })
  })

  it('builds URLs with search params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await requestAhrefsJson({
      config: { apiKey: 'test-key' },
      path: '/v3/site-explorer/domain-rating',
      searchParams: { target: 'example.com', date: '2024-01-01' },
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe(
      'https://api.ahrefs.com/v3/site-explorer/domain-rating?target=example.com&date=2024-01-01'
    )
  })

  it('extracts retry-after from 429 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '45' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestAhrefsJson({
      config: { apiKey: 'test-key' },
      path: '/v3/site-explorer/metrics',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryAfter).toBe(45)
      expect(result.status).toBe(429)
    }
  })

  it('ignores invalid retry-after values and empty search params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'try later' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestAhrefsJson({
      config: { apiKey: 'test-key' },
      path: '/v3/site-explorer/metrics',
      searchParams: { target: 'example.com', date: '' },
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://api.ahrefs.com/v3/site-explorer/metrics?target=example.com')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryAfter).toBeUndefined()
      expect(result.message).toBe('Ahrefs request failed (429): try later')
    }
  })

  it('uses text response bodies as error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('plain failure', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      })
    ))

    const result = await requestAhrefsJson({
      config: { apiKey: 'test-key' },
      path: '/v3/site-explorer/metrics',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Ahrefs request failed (500): plain failure')
      expect(result.data).toBe('plain failure')
    }
  })

  it('returns null data for no-content responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    const result = await requestAhrefsJson({
      config: { apiKey: 'test-key' },
      path: '/v3/site-explorer/metrics',
    })

    expect(result).toMatchObject({ ok: true, data: null, status: 204 })
  })

  it('handles network errors gracefully', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network failure'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestAhrefsJson({
      config: { apiKey: 'test-key' },
      path: '/v3/site-explorer/metrics',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Network failure')
      expect(result.status).toBe(0)
    }
  })

  it('testAhrefsConnection hits the free limits endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ limits_and_usage: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await testAhrefsConnection({ apiKey: 'test-key' })

    expect(result.ok).toBe(true)
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/subscription-info/limits-and-usage')
  })
})
