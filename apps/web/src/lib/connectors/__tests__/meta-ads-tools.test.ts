import { beforeEach, describe, expect, it, vi } from 'vitest'

const metaAdsClientMocks = vi.hoisted(() => ({
  getMetaAdsAccountInsights: vi.fn(),
  getMetaAdsCampaignInsights: vi.fn(),
  getMetaAdsObject: vi.fn(),
  listMetaAdAccounts: vi.fn(),
  listMetaAdsAdSets: vi.fn(),
  listMetaAdsAds: vi.fn(),
  listMetaAdsCampaigns: vi.fn(),
}))

vi.mock('@/lib/connectors/meta-ads-client', () => ({
  getMetaAdsAccountInsights: metaAdsClientMocks.getMetaAdsAccountInsights,
  getMetaAdsCampaignInsights: metaAdsClientMocks.getMetaAdsCampaignInsights,
  getMetaAdsObject: metaAdsClientMocks.getMetaAdsObject,
  listMetaAdAccounts: metaAdsClientMocks.listMetaAdAccounts,
  listMetaAdsAdSets: metaAdsClientMocks.listMetaAdsAdSets,
  listMetaAdsAds: metaAdsClientMocks.listMetaAdsAds,
  listMetaAdsCampaigns: metaAdsClientMocks.listMetaAdsCampaigns,
}))

import {
  executeMetaAdsMcpTool,
  getMetaAdsMcpTools,
} from '@/lib/connectors/meta-ads-tools'

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

function parseToolResult(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

describe('meta-ads-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    metaAdsClientMocks.listMetaAdAccounts.mockResolvedValue({
      ok: true,
      data: { items: [], paging: undefined },
      status: 200,
      headers: new Headers(),
    })
    metaAdsClientMocks.listMetaAdsCampaigns.mockResolvedValue({
      ok: true,
      data: { items: [], paging: undefined },
      status: 200,
      headers: new Headers(),
    })
    metaAdsClientMocks.getMetaAdsAccountInsights.mockResolvedValue({
      ok: true,
      data: { items: [], paging: undefined },
      status: 200,
      headers: new Headers(),
    })
    metaAdsClientMocks.getMetaAdsObject.mockResolvedValue({
      ok: true,
      data: { id: 'cmp_1', name: 'Campaign 1', account_id: '123' },
      status: 200,
      headers: new Headers(),
    })
    metaAdsClientMocks.getMetaAdsCampaignInsights.mockResolvedValue({
      ok: true,
      data: { items: [], paging: undefined },
      status: 200,
      headers: new Headers(),
    })
  })

  it('exposes the expected read-only tool set', () => {
    expect(getMetaAdsMcpTools(config).map((tool) => tool.name)).toEqual([
      'list_ad_accounts',
      'list_campaigns',
      'list_ad_sets',
      'list_ads',
      'get_account_insights',
      'get_campaign_insights',
    ])

    expect(getMetaAdsMcpTools({
      ...config,
      permissions: {
        ...config.permissions,
        allowRead: false,
      },
    })).toEqual([])
  })

  it('filters listed ad accounts to the workspace-selected accounts', async () => {
    metaAdsClientMocks.listMetaAdAccounts.mockResolvedValue({
      ok: true,
      data: {
        items: [
          { id: 'act_123', accountId: '123', name: 'Main account' },
          { id: 'act_999', accountId: '999', name: 'Hidden account' },
        ],
      },
      status: 200,
      headers: new Headers(),
    })

    const result = await executeMetaAdsMcpTool(config, 'list_ad_accounts', {})

    expect(parseToolResult(result)).toEqual({
      ok: true,
      adAccounts: [
        { id: 'act_123', accountId: '123', name: 'Main account' },
      ],
    })
  })

  it('requires accountId when multiple accounts are enabled without a default', async () => {
    const result = await executeMetaAdsMcpTool({
      ...config,
      selectedAdAccountIds: ['act_123', 'act_456'],
      defaultAdAccountId: undefined,
    }, 'list_campaigns', {})

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'missing_account',
      message: 'accountId is required when multiple Meta ad accounts are enabled for this workspace.',
    })
    expect(result.isError).toBe(true)
    expect(metaAdsClientMocks.listMetaAdsCampaigns).not.toHaveBeenCalled()
  })

  it('clamps insights limits and omits datePreset when an explicit range is provided', async () => {
    const result = await executeMetaAdsMcpTool(config, 'get_account_insights', {
      accountId: '123',
      since: '2026-01-01',
      until: '2026-01-31',
      datePreset: 'today',
      limit: 999,
    })

    expect(metaAdsClientMocks.getMetaAdsAccountInsights).toHaveBeenCalledWith(config, 'act_123', {
      datePreset: undefined,
      since: '2026-01-01',
      until: '2026-01-31',
      limit: 100,
    })
    expect(parseToolResult(result)).toEqual({
      ok: true,
      accountId: 'act_123',
      insights: [],
      paging: undefined,
    })
  })

  it('blocks campaign insights when the campaign belongs to a non-enabled account', async () => {
    metaAdsClientMocks.getMetaAdsObject.mockResolvedValue({
      ok: true,
      data: {
        id: 'cmp_9',
        name: 'Other campaign',
        account_id: '999',
      },
      status: 200,
      headers: new Headers(),
    })

    const result = await executeMetaAdsMcpTool(config, 'get_campaign_insights', {
      campaignId: 'cmp_9',
    })

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'forbidden_campaign',
      message: 'Campaign cmp_9 does not belong to an enabled Meta ad account.',
    })
    expect(result.isError).toBe(true)
    expect(metaAdsClientMocks.getMetaAdsCampaignInsights).not.toHaveBeenCalled()
  })
})
