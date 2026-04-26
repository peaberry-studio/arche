import { handleEmbeddedConnectorMcpRequest } from '@/lib/connectors/mcp/json-rpc'
import {
  executeMetaAdsMcpTool,
  getMetaAdsMcpProtocolVersion,
  getMetaAdsMcpTools,
  parseMetaAdsConnectorConfig,
} from '@/lib/connectors/meta-ads'

const META_ADS_MCP_SERVER_INFO = {
  name: 'arche-meta-ads-connector',
  version: '0.1.0',
}

export async function handleMetaAdsMcpRequest(
  request: Request,
  decryptedConfig: Record<string, unknown>
): Promise<Response> {
  return handleEmbeddedConnectorMcpRequest({
    request,
    decryptedConfig,
    connectorLabel: 'Meta Ads',
    serverInfo: META_ADS_MCP_SERVER_INFO,
    protocolVersion: getMetaAdsMcpProtocolVersion(),
    parseConfig: parseMetaAdsConnectorConfig,
    getTools: getMetaAdsMcpTools,
    executeTool: async (_config, toolName, args) => {
      return executeMetaAdsMcpTool(decryptedConfig, toolName, args)
    },
  })
}
