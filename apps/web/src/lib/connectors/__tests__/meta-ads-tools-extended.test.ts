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

describe('meta-ads-tools extended', () => {
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
    metaAdsClientMocks.listMetaAdsAdSets.mockResolvedValue({
      ok: true,
      data: { items: [], paging: undefined },
      status: 200,
      headers: new Headers(),
    })
    metaAdsClientMocks.listMetaAdsAds.mockResolvedValue({
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

  it('returns empty tools list when read access is disabled', () => {
    expect(getMetaAdsMcpTools({
      ...config,
      permissions: { ...config.permissions, allowRead: false },
    })).toEqual([])
  })

  it('handles invalid config in tool execution', async () => {
    const result = await executeMetaAdsMcpTool(
      { authType: 'manual' },
      'list_ad_accounts',
      {}
    )

    expect(result.isError).toBe(true)
    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_config')
  })

  it('handles forbidden when read access is disabled', async () => {
    const result = await executeMetaAdsMcpTool(
      { ...config, permissions: { ...config.permissions, allowRead: false } },
      'list_ad_accounts',
      {}
    )

    expect(result.isError).toBe(true)
    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('forbidden')
  })

  it('handles list_ad_sets with resolved account', async () => {
    metaAdsClientMocks.listMetaAdsAdSets.mockResolvedValue({
      ok: true,
      data: {
        items: [{ id: 'adset-1', name: 'Test AdSet' }],
        paging: { next: 'https://next', previous: undefined },
      },
      status: 200,
      headers: new Headers(),
    })

    const result = await executeMetaAdsMcpTool(config, 'list_ad_sets', {})
    const parsed = parseToolResult(result) as { ok: boolean; adSets: unknown[] }

    expect(parsed.ok).toBe(true)
    expect(parsed.adSets).toHaveLength(1)
    expect(metaAdsClientMocks.listMetaAdsAdSets).toHaveBeenCalledWith(config, 'act_123', 25)
  })

  it('handles list_ads with resolved account', async () => {
    metaAdsClientMocks.listMetaAdsAds.mockResolvedValue({
      ok: true,
      data: {
        items: [{ id: 'ad-1', name: 'Test Ad' }],
        paging: undefined,
      },
      status: 200,
      headers: new Headers(),
    })

    const result = await executeMetaAdsMcpTool(config, 'list_ads', {})
    const parsed = parseToolResult(result) as { ok: boolean; ads: unknown[] }

    expect(parsed.ok).toBe(true)
    expect(parsed.ads).toHaveLength(1)
    expect(metaAdsClientMocks.listMetaAdsAds).toHaveBeenCalledWith(config, 'act_123', 25)
  })

  it('handles get_account_insights with datePreset', async () => {
    metaAdsClientMocks.getMetaAdsAccountInsights.mockResolvedValue({
      ok: true,
      data: {
        items: [{ clicks: '10', spend: '100' }],
        paging: undefined,
      },
      status: 200,
      headers: new Headers(),
    })

    const result = await executeMetaAdsMcpTool(config, 'get_account_insights', {
      datePreset: 'today',
      limit: 10,
    })
    const parsed = parseToolResult(result) as { ok: boolean; insights: unknown[] }

    expect(parsed.ok).toBe(true)
    expect(parsed.insights).toHaveLength(1)
    expect(metaAdsClientMocks.getMetaAdsAccountInsights).toHaveBeenCalledWith(config, 'act_123', {
      datePreset: 'today',
      since: undefined,
      until: undefined,
      limit: 10,
    })
  })

  it('rejects invalid datePreset', async () => {
    const result = await executeMetaAdsMcpTool(config, 'get_account_insights', {
      datePreset: 'invalid_preset',
    })
    const parsed = parseToolResult(result) as { ok: boolean; error: string; message: string }

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(parsed.message).toContain('datePreset must be one of')
  })

  it('rejects mismatched since/until dates', async () => {
    const result = await executeMetaAdsMcpTool(config, 'get_account_insights', {
      since: '2026-01-01',
    })
    const parsed = parseToolResult(result) as { ok: boolean; error: string }

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
  })

  it('allows date range with both since and until', async () => {
    metaAdsClientMocks.getMetaAdsAccountInsights.mockResolvedValue({
      ok: true,
      data: { items: [], paging: undefined },
      status: 200,
      headers: new Headers(),
    })

    const result = await executeMetaAdsMcpTool(config, 'get_account_insights', {
      since: '2026-01-01',
      until: '2026-01-31',
    })
    const parsed = parseToolResult(result) as { ok: boolean }

    expect(parsed.ok).toBe(true)
    expect(metaAdsClientMocks.getMetaAdsAccountInsights).toHaveBeenCalledWith(config, 'act_123', {
      datePreset: undefined,
      since: '2026-01-01',
      until: '2026-01-31',
      limit: 25,
    })
  })

  it('resolves requested accountId when provided', async () => {
    metaAdsClientMocks.listMetaAdsCampaigns.mockResolvedValue({
      ok: true,
      data: { items: [{ id: 'camp-1' }], paging: undefined },
      status: 200,
      headers: new Headers(),
    })

    const multiConfig = {
      ...config,
      selectedAdAccountIds: ['act_123', 'act_456'],
      defaultAdAccountId: undefined,
    }

    const result = await executeMetaAdsMcpTool(multiConfig, 'list_campaigns', { accountId: '123' })
    const parsed = parseToolResult(result) as { ok: boolean; accountId: string }

    expect(parsed.ok).toBe(true)
    expect(parsed.accountId).toBe('act_123')
  })

  it('forbids non-selected accountId', async () => {
    const multiConfig = {
      ...config,
      selectedAdAccountIds: ['act_123'],
      defaultAdAccountId: undefined,
    }

    const result = await executeMetaAdsMcpTool(multiConfig, 'list_campaigns', { accountId: '999' })
    const parsed = parseToolResult(result) as { ok: boolean; error: string }

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('forbidden_account')
  })

  it('returns default account when only one is selected', async () => {
    metaAdsClientMocks.listMetaAdsCampaigns.mockResolvedValue({
      ok: true,
      data: { items: [], paging: undefined },
      status: 200,
      headers: new Headers(),
    })

    const singleConfig = {
      ...config,
      selectedAdAccountIds: ['act_123'],
      defaultAdAccountId: undefined,
    }

    const result = await executeMetaAdsMcpTool(singleConfig, 'list_campaigns', {})
    const parsed = parseToolResult(result) as { ok: boolean; accountId: string }

    expect(parsed.ok).toBe(true)
    expect(parsed.accountId).toBe('act_123')
  })

  it('handles get_campaign_insights with valid campaignId', async () => {
    metaAdsClientMocks.getMetaAdsObject.mockResolvedValue({
      ok: true,
      data: { id: 'cmp_1', name: 'Campaign 1', account_id: '123' },
      status: 200,
      headers: new Headers(),
    })
    metaAdsClientMocks.getMetaAdsCampaignInsights.mockResolvedValue({
      ok: true,
      data: { items: [{ clicks: '5' }], paging: undefined },
      status: 200,
      headers: new Headers(),
    })

    const result = await executeMetaAdsMcpTool(config, 'get_campaign_insights', {
      campaignId: 'cmp_1',
      datePreset: 'last_30d',
    })
    const parsed = parseToolResult(result) as { ok: boolean; campaign: { name: string } }

    expect(parsed.ok).toBe(true)
    expect(parsed.campaign.name).toBe('Campaign 1')
    expect(metaAdsClientMocks.getMetaAdsCampaignInsights).toHaveBeenCalled()
  })

  it('requires campaignId for get_campaign_insights', async () => {
    const result = await executeMetaAdsMcpTool(config, 'get_campaign_insights', {})
    const parsed = parseToolResult(result) as { ok: boolean; error: string }

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
  })

  it('returns error for unknown tool name', async () => {
    const result = await executeMetaAdsMcpTool(config, 'unknown_tool', {})
    const parsed = parseToolResult(result) as { ok: boolean; error: string }

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('method_not_found')
  })

  it('returns protocol version', async () => {
    const { getMetaAdsMcpProtocolVersion } = await import('@/lib/connectors/meta-ads-tools')
    expect(getMetaAdsMcpProtocolVersion()).toBe('2025-03-26')
  })
})
