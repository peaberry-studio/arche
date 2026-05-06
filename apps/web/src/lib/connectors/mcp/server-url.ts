import { getGoogleWorkspaceMcpServerUrl, isGoogleWorkspaceConnectorType } from '@/lib/connectors/google-workspace'
import { getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import type { ConnectorType } from '@/lib/connectors/types'

const MCP_SERVER_URLS = {
  linear: 'https://mcp.linear.app/mcp',
  notion: 'https://mcp.notion.com/mcp',
} as const

export function getConnectorMcpServerUrl(type: 'linear' | 'notion', config: Record<string, unknown>): string
export function getConnectorMcpServerUrl(type: 'custom', config: Record<string, unknown>): string | null
export function getConnectorMcpServerUrl(type: 'google_gmail' | 'google_drive' | 'google_calendar' | 'google_chat' | 'google_people', config: Record<string, unknown>): string
export function getConnectorMcpServerUrl(type: ConnectorType, config: Record<string, unknown>): string | null
export function getConnectorMcpServerUrl(type: ConnectorType, config: Record<string, unknown>): string | null {
  const oauth = getConnectorOAuthConfig(type, config)
  if ((type === 'linear' || type === 'notion' || type === 'custom') && oauth?.mcpServerUrl) {
    return oauth.mcpServerUrl
  }

  if (isGoogleWorkspaceConnectorType(type)) {
    return getGoogleWorkspaceMcpServerUrl(type)
  }

  switch (type) {
    case 'linear':
      return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || MCP_SERVER_URLS.linear
    case 'notion':
      return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || MCP_SERVER_URLS.notion
    case 'custom': {
      const endpoint = config.endpoint
      return typeof endpoint === 'string' ? endpoint : null
    }
    case 'zendesk':
    case 'meta-ads':
    case 'ahrefs':
    case 'umami':
      return null
  }
}
