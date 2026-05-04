import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getMetaAdsAccountInsights,
  getMetaAdsCampaignInsights,
  getMetaAdsObject,
  listMetaAdsAds,
  listMetaAdsAdSets,
  listMetaAdAccounts,
  listMetaAdsCampaigns,
  testMetaAdsConnection,
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

  it('returns invalid_config before calling Meta when required app fields are missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await listMetaAdAccounts({ authType: 'oauth' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalid_config')
      expect(result.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns network_error when the Meta request fails before a response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const result = await listMetaAdAccounts(config)

    expect(result).toEqual({
      ok: false,
      error: 'network_error',
      message: 'Meta Ads request failed before reaching the API.',
      status: 502,
    })
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

  it('treats an embedded Meta error object as a failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: '190',
          message: 'Invalid OAuth token',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))

    const result = await listMetaAdAccounts(config)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('190')
      expect(result.message).toBe('Invalid OAuth token')
      expect(result.status).toBe(200)
    }
  })

  it('fetches arbitrary Meta objects with normalized leading slashes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'act_123', name: 'Account' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getMetaAdsObject(config, '/act_123', 'id,name')

    expect(result.ok).toBe(true)
    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/v25.0/act_123')
    expect(url.searchParams.get('fields')).toBe('id,name')
  })

  it('lists campaigns, ad sets, and ads as generic record lists', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({
        data: [{ id: '1', name: 'Record' }, 'invalid'],
        paging: { previous: 'https://graph.facebook.com/previous-page' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const campaigns = await listMetaAdsCampaigns(config, 'act_123', 7)
    const adSets = await listMetaAdsAdSets(config, 'act_123', 8)
    const ads = await listMetaAdsAds(config, 'act_123', 9)

    for (const result of [campaigns, adSets, ads]) {
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.items).toEqual([{ id: '1', name: 'Record' }])
        expect(result.data.paging).toEqual({
          next: undefined,
          previous: 'https://graph.facebook.com/previous-page',
        })
      }
    }

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/v25.0/act_123/campaigns')
    expect(new URL(fetchMock.mock.calls[1][0] as string).pathname).toBe('/v25.0/act_123/adsets')
    expect(new URL(fetchMock.mock.calls[2][0] as string).pathname).toBe('/v25.0/act_123/ads')
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

  it('encodes campaign insights date presets without a custom time range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await getMetaAdsCampaignInsights(config, 'campaign_1', { datePreset: 'last_7d' })

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/v25.0/campaign_1/insights')
    expect(url.searchParams.get('date_preset')).toBe('last_7d')
    expect(url.searchParams.get('time_range')).toBeNull()
    expect(url.searchParams.get('limit')).toBeNull()
  })

  it('reports Meta connection status from accessible accounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          { id: 'act_123', account_id: '123', name: 'Main account' },
          { id: 'act_456', account_id: '456', name: 'Backup account' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))

    await expect(testMetaAdsConnection(config)).resolves.toEqual({
      ok: true,
      message: 'Meta Ads connection verified. Accessible ad accounts: 2.',
    })
    await expect(testMetaAdsConnection({ authType: 'oauth', appId: 'meta-app-id', appSecret: 'meta-app-secret' })).resolves.toEqual({
      ok: false,
      message: 'Meta Ads connector is not authenticated.',
    })
  })
})
