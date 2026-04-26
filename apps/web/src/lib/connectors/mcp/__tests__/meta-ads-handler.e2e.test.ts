import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleMetaAdsMcpRequest } from '@/lib/connectors/mcp/meta-ads-handler'

const config = {
  authType: 'oauth' as const,
  appId: 'meta-app-id',
  appSecret: 'meta-app-secret',
  permissions: {
    allowRead: true,
    allowWriteCampaigns: false,
    allowWriteAdSets: false,
    allowWriteAds: false,
  },
  selectedAdAccountIds: ['act_123'],
  defaultAdAccountId: 'act_123',
  oauth: {
    provider: 'meta-ads' as const,
    accessToken: 'meta-token',
    clientId: 'meta-app-id',
  },
}

function buildRequest(body: unknown): Request {
  return new Request('https://arche.example.com/api/internal/mcp/connectors/connector-1/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function parseToolPayload(response: Response): Promise<{
  jsonrpc: string
  id: string | number | null
  result: { content: Array<{ text: string }>; isError?: boolean }
}> {
  return await response.json() as {
    jsonrpc: string
    id: string | number | null
    result: { content: Array<{ text: string }>; isError?: boolean }
  }
}

describe('handleMetaAdsMcpRequest e2e', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the read-only Meta Ads tools from the real handler stack', async () => {
    const response = await handleMetaAdsMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-1', method: 'tools/list' }),
      config,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'list_ad_accounts' }),
          expect.objectContaining({ name: 'list_campaigns' }),
          expect.objectContaining({ name: 'get_account_insights' }),
          expect.objectContaining({ name: 'get_campaign_insights' }),
        ]),
      },
    })
  })

  it('executes list_campaigns end-to-end using the default ad account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          {
            id: 'cmp_1',
            name: 'Campaign 1',
            objective: 'OUTCOME_TRAFFIC',
            status: 'ACTIVE',
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

    const response = await handleMetaAdsMcpRequest(
      buildRequest({
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'tools/call',
        params: {
          name: 'list_campaigns',
          arguments: {
            limit: 3,
          },
        },
      }),
      config,
    )

    expect(response.status).toBe(200)

    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/v25.0/act_123/campaigns')
    expect(url.searchParams.get('limit')).toBe('3')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer meta-token',
    })

    const payload = await parseToolPayload(response)
    expect(payload.jsonrpc).toBe('2.0')
    expect(payload.id).toBe('req-2')
    expect(JSON.parse(payload.result.content[0]?.text ?? 'null')).toEqual({
      ok: true,
      accountId: 'act_123',
      campaigns: [
        {
          id: 'cmp_1',
          name: 'Campaign 1',
          objective: 'OUTCOME_TRAFFIC',
          status: 'ACTIVE',
        },
      ],
      paging: {
        next: 'https://graph.facebook.com/next-page',
      },
    })
  })

  it('blocks campaign insights end-to-end when the campaign is outside the enabled accounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'cmp_9',
        name: 'Other campaign',
        account_id: '999',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleMetaAdsMcpRequest(
      buildRequest({
        jsonrpc: '2.0',
        id: 'req-3',
        method: 'tools/call',
        params: {
          name: 'get_campaign_insights',
          arguments: {
            campaignId: 'cmp_9',
          },
        },
      }),
      config,
    )

    expect(response.status).toBe(200)

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/v25.0/cmp_9')
    expect(url.searchParams.get('fields')).toBe('id,name,account_id')

    const payload = await parseToolPayload(response)
    expect(payload.result.isError).toBe(true)
    expect(JSON.parse(payload.result.content[0]?.text ?? 'null')).toEqual({
      ok: false,
      error: 'forbidden_campaign',
      message: 'Campaign cmp_9 does not belong to an enabled Meta ad account.',
    })
  })
})
