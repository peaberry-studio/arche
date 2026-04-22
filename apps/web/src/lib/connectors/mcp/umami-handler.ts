import { handleEmbeddedConnectorMcpRequest } from '@/lib/connectors/mcp/json-rpc'
import {
  executeUmamiMcpTool,
  getUmamiMcpProtocolVersion,
  getUmamiMcpTools,
  parseUmamiConnectorConfig,
} from '@/lib/connectors/umami'

const UMAMI_MCP_SERVER_INFO = {
  name: 'arche-umami-connector',
  version: '0.1.0',
}

export async function handleUmamiMcpRequest(
  request: Request,
  decryptedConfig: Record<string, unknown>
): Promise<Response> {
  return handleEmbeddedConnectorMcpRequest({
    request,
    decryptedConfig,
    connectorLabel: 'Umami',
    serverInfo: UMAMI_MCP_SERVER_INFO,
    protocolVersion: getUmamiMcpProtocolVersion(),
    parseConfig: parseUmamiConnectorConfig,
    getTools: () => getUmamiMcpTools(),
    executeTool: executeUmamiMcpTool,
  })
}
