import { getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import type { ConnectorType } from '@/lib/connectors/types'

const MCP_SERVER_URLS = {
  linear: 'https://mcp.linear.app/mcp',
  notion: 'https://mcp.notion.com/mcp',
} as const

export function getConnectorMcpServerUrl(type: 'linear' | 'notion', config: Record<string, unknown>): string
export function getConnectorMcpServerUrl(type: 'custom', config: Record<string, unknown>): string | null
export function getConnectorMcpServerUrl(type: ConnectorType, config: Record<string, unknown>): string | null {
  const oauth = getConnectorOAuthConfig(type, config)
  if (oauth?.mcpServerUrl) {
    return oauth.mcpServerUrl
  }

  if (type === 'linear') {
    return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || MCP_SERVER_URLS.linear
  }

  if (type === 'notion') {
    return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || MCP_SERVER_URLS.notion
  }

  if (type === 'zendesk') {
    return null
  }

  const endpoint = config.endpoint
  return typeof endpoint === 'string' ? endpoint : null
}
