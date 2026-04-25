import { handleEmbeddedConnectorMcpRequest } from '@/lib/connectors/mcp/json-rpc'
import {
  executeZendeskMcpTool,
  getZendeskMcpProtocolVersion,
  getZendeskMcpTools,
  parseZendeskConnectorConfig,
} from '@/lib/connectors/zendesk'

const ZENDESK_MCP_SERVER_INFO = {
  name: 'arche-zendesk-connector',
  version: '0.1.0',
}

export async function handleZendeskMcpRequest(
  request: Request,
  decryptedConfig: Record<string, unknown>
): Promise<Response> {
  return handleEmbeddedConnectorMcpRequest({
    request,
    decryptedConfig,
    connectorLabel: 'Zendesk',
    serverInfo: ZENDESK_MCP_SERVER_INFO,
    protocolVersion: getZendeskMcpProtocolVersion(),
    parseConfig: parseZendeskConnectorConfig,
    getTools: getZendeskMcpTools,
    executeTool: executeZendeskMcpTool,
  })
}
