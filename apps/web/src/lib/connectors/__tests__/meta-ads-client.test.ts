import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getMetaAdsAccountInsights,
  listMetaAdAccounts,
} from '@/lib/connectors/meta-ads-client'

const config = {
  authType: 'oauth' as const,
  appId: 'meta-app-id',
  appSecret: 'meta-app-secret',
  selectedAdAccountIds: ['act_123'],
  oauth: {
    provider: 'meta-ads' as const,
    accessToken: 'meta-token',
    clientId: 'meta-app-id',
  },
}

describe('meta-ads-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists ad accounts with Bearer authorization and maps valid records', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          {
            id: 'act_123',
            account_id: '123',
            name: 'Main account',
            account_status: 1,
            currency: 'EUR',
            timezone_name: 'Europe/Madrid',
          },
          {
            id: 'act_broken',
            name: 'Broken account',
          },
        ],
        paging: {
          next: 'https://graph.facebook.com/next-page',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listMetaAdAccounts(config)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        items: [
          {
            id: 'act_123',
            accountId: '123',
            name: 'Main account',
            accountStatus: 1,
            currency: 'EUR',
            timezoneName: 'Europe/Madrid',
          },
        ],
        paging: {
          next: 'https://graph.facebook.com/next-page',
          previous: undefined,
        },
      })
    }

    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/v25.0/me/adaccounts')
    expect(url.searchParams.get('limit')).toBe('500')
    expect(url.searchParams.get('fields')).toBe('id,account_id,name,account_status,currency,timezone_name')
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer meta-token',
    })
    expect(init.cache).toBe('no-store')
  })

  it('returns not_authenticated before calling Meta when OAuth is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await listMetaAdAccounts({
      authType: 'oauth',
      appId: 'meta-app-id',
      appSecret: 'meta-app-secret',
    })

    expect(result).toEqual({
      ok: false,
      error: 'not_authenticated',
      message: 'Meta Ads connector is not authenticated.',
      status: 401,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates Meta API errors and retry-after headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: 613,
          message: 'Rate limit reached',
        },
      }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '42',
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listMetaAdAccounts(config)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('613')
      expect(result.message).toBe('Rate limit reached')
      expect(result.status).toBe(429)
      expect(result.retryAfter).toBe(42)
    }
  })

  it('encodes explicit date ranges for insights requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await getMetaAdsAccountInsights(config, 'act_123', {
      since: '2026-01-01',
      until: '2026-01-31',
      limit: 50,
    })

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/v25.0/act_123/insights')
    expect(url.searchParams.get('time_range')).toBe(JSON.stringify({
      since: '2026-01-01',
      until: '2026-01-31',
    }))
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('date_preset')).toBeNull()
  })
})
