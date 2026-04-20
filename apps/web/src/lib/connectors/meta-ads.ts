export { parseMetaAdsConnectorConfig, parseMetaAdsConnectorPermissions, parseMetaAdsSelectedAdAccountIds, validateMetaAdsConnectorConfig, isMetaAdsConnectorReady, normalizeMetaAdsAccountId } from '@/lib/connectors/meta-ads-config'
export { listMetaAdAccounts, listMetaAdsAdSets, listMetaAdsAds, listMetaAdsCampaigns, testMetaAdsConnection } from '@/lib/connectors/meta-ads-client'
export { executeMetaAdsMcpTool, getMetaAdsMcpProtocolVersion, getMetaAdsMcpTools } from '@/lib/connectors/meta-ads-tools'
export type { MetaAdsAdAccount, MetaAdsApiResponse, MetaAdsConnectorConfig, MetaAdsConnectorPermissions, MetaAdsMcpTool, MetaAdsMcpToolResult } from '@/lib/connectors/meta-ads-types'
