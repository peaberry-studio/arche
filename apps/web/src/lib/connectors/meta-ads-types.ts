export const META_ADS_CONNECTOR_PERMISSION_KEYS = [
  'allowRead',
  'allowWriteCampaigns',
  'allowWriteAdSets',
  'allowWriteAds',
] as const

export type MetaAdsConnectorPermissions = {
  allowRead: boolean
  allowWriteCampaigns: boolean
  allowWriteAdSets: boolean
  allowWriteAds: boolean
}

export const DEFAULT_META_ADS_CONNECTOR_PERMISSIONS: MetaAdsConnectorPermissions = {
  allowRead: true,
  allowWriteCampaigns: false,
  allowWriteAdSets: false,
  allowWriteAds: false,
}

export type MetaAdsConnectorConfig = {
  authType: 'oauth'
  appId: string
  appSecret: string
  permissions: MetaAdsConnectorPermissions
  selectedAdAccountIds: string[]
  defaultAdAccountId?: string
}

export type MetaAdsAdAccount = {
  id: string
  accountId: string
  name: string
  accountStatus?: number
  currency?: string
  timezoneName?: string
}

export type MetaAdsListResult<T> = {
  items: T[]
  paging?: {
    next?: string
    previous?: string
  }
}

export type MetaAdsApiResponse<T> =
  | {
      ok: true
      data: T
      status: number
      headers: Headers
    }
  | {
      ok: false
      error: string
      message: string
      status: number
      headers?: Headers
      data?: unknown
      retryAfter?: number
    }

export type MetaAdsToolName =
  | 'list_ad_accounts'
  | 'list_campaigns'
  | 'list_ad_sets'
  | 'list_ads'
  | 'get_account_insights'
  | 'get_campaign_insights'

export type MetaAdsMcpTextContent = {
  type: 'text'
  text: string
}

export type MetaAdsMcpToolResult = {
  content: MetaAdsMcpTextContent[]
  isError?: boolean
}

export type MetaAdsMcpTool = {
  name: MetaAdsToolName
  description: string
  inputSchema: Record<string, unknown>
}
