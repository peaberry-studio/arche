import { handleEmbeddedConnectorMcpRequest } from '@/lib/connectors/mcp/json-rpc'
import {
  executeAhrefsMcpTool,
  getAhrefsMcpProtocolVersion,
  getAhrefsMcpTools,
  parseAhrefsConnectorConfig,
} from '@/lib/connectors/ahrefs'

const AHREFS_MCP_SERVER_INFO = {
  name: 'arche-ahrefs-connector',
  version: '0.1.0',
}

export async function handleAhrefsMcpRequest(
  request: Request,
  decryptedConfig: Record<string, unknown>
): Promise<Response> {
  return handleEmbeddedConnectorMcpRequest({
    request,
    decryptedConfig,
    connectorLabel: 'Ahrefs',
    serverInfo: AHREFS_MCP_SERVER_INFO,
    protocolVersion: getAhrefsMcpProtocolVersion(),
    parseConfig: parseAhrefsConnectorConfig,
    getTools: () => getAhrefsMcpTools(),
    executeTool: executeAhrefsMcpTool,
  })
}
