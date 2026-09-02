export {
  parseZendeskConnectorConfig,
  parseZendeskConnectorPermissions,
  validateZendeskConnectorConfig,
} from '@/lib/connectors/zendesk-config'
export {
  buildLegacyProjectionFromActionPermissions,
  getZendeskRuntimeToolPermissions,
  mergeLegacyToolPermissions,
  normalizeZendeskActionPermissions,
  parseZendeskActionPermissionsConfig,
  resolveZendeskActionPermissions,
} from '@/lib/connectors/zendesk-action-permissions'
export { testZendeskConnection } from '@/lib/connectors/zendesk-client'
export {
  executeZendeskMcpTool,
  getZendeskMcpProtocolVersion,
  getZendeskMcpTools,
} from '@/lib/connectors/zendesk-tools'
export type {
  ZendeskActionName,
  ZendeskActionPermissions,
  ZendeskActionPermissionsConfig,
  ZendeskActionPolicy,
  ZendeskApiResponse,
  ZendeskConnectorConfig,
  ZendeskConnectorPermissions,
  ZendeskMcpTool,
  ZendeskMcpToolResult,
} from '@/lib/connectors/zendesk-types'
