export { parseZendeskConnectorConfig, validateZendeskConnectorConfig } from '@/lib/connectors/zendesk-config'
export { testZendeskConnection } from '@/lib/connectors/zendesk-client'
export {
  executeZendeskMcpTool,
  getZendeskMcpProtocolVersion,
  getZendeskMcpTools,
} from '@/lib/connectors/zendesk-tools'
export type {
  ZendeskApiResponse,
  ZendeskConnectorConfig,
  ZendeskMcpTool,
  ZendeskMcpToolResult,
} from '@/lib/connectors/zendesk-types'
