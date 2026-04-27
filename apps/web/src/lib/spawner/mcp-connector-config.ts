import { parseAhrefsConnectorConfig } from '@/lib/connectors/ahrefs'
import { getGoogleWorkspaceMcpServerUrl, isGoogleWorkspaceConnectorType } from '@/lib/connectors/google-workspace'
import { isMetaAdsConnectorReady, parseMetaAdsConnectorConfig } from '@/lib/connectors/meta-ads'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { parseUmamiConnectorConfig } from '@/lib/connectors/umami'
import type { ConnectorType } from '@/lib/connectors/types'
import { parseZendeskConnectorConfig } from '@/lib/connectors/zendesk'
import type { GatewayTarget, McpServerConfig } from '@/lib/spawner/mcp-config'

type EmbeddedConnectorParser = (config: Record<string, unknown>) => { ok: boolean }

const EMBEDDED_CONNECTOR_PARSERS: Partial<Record<ConnectorType, EmbeddedConnectorParser>> = {
  zendesk: parseZendeskConnectorConfig,
  ahrefs: parseAhrefsConnectorConfig,
  umami: parseUmamiConnectorConfig,
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') record[key] = entry
  }
  return Object.keys(record).length ? record : undefined
}

function buildGatewayRemoteMcpConfig(gatewayTarget: GatewayTarget): McpServerConfig {
  return {
    type: 'remote',
    url: gatewayTarget.url,
    enabled: true,
    headers: {
      Authorization: `Bearer ${gatewayTarget.token}`,
    },
    oauth: false,
  }
}

function buildOAuthRemoteMcpConfig(input: {
  connectorId: string
  connectorType: ConnectorType
  config: Record<string, unknown>
  gatewayTargets?: Record<string, GatewayTarget>
  defaultMcpUrl: string
}): McpServerConfig | undefined {
  const gatewayTarget = input.gatewayTargets?.[input.connectorId]
  if (gatewayTarget) return buildGatewayRemoteMcpConfig(gatewayTarget)

  const oauthToken = getConnectorOAuthConfig(input.connectorType, input.config)?.accessToken
  if (!oauthToken) return undefined

  return {
    type: 'remote',
    url: input.defaultMcpUrl,
    enabled: true,
    headers: {
      Authorization: `Bearer ${oauthToken}`,
    },
    oauth: false,
  }
}

function buildNotionMcpServerConfig(input: {
  connectorId: string
  config: Record<string, unknown>
  gatewayTargets?: Record<string, GatewayTarget>
}): McpServerConfig | undefined {
  if (getConnectorAuthType(input.config) === 'oauth') {
    return buildOAuthRemoteMcpConfig({
      connectorId: input.connectorId,
      connectorType: 'notion',
      config: input.config,
      gatewayTargets: input.gatewayTargets,
      defaultMcpUrl: 'https://mcp.notion.com/mcp',
    })
  }

  const notionApiKey = getString(input.config.apiKey)
  if (!notionApiKey) return undefined

  return {
    type: 'local',
    command: ['npx', '-y', '@suekou/mcp-notion-server'],
    enabled: true,
    environment: {
      NOTION_API_TOKEN: notionApiKey,
    },
  }
}

function buildLinearMcpServerConfig(input: {
  connectorId: string
  config: Record<string, unknown>
  gatewayTargets?: Record<string, GatewayTarget>
}): McpServerConfig | undefined {
  if (getConnectorAuthType(input.config) === 'oauth') {
    return buildOAuthRemoteMcpConfig({
      connectorId: input.connectorId,
      connectorType: 'linear',
      config: input.config,
      gatewayTargets: input.gatewayTargets,
      defaultMcpUrl: 'https://mcp.linear.app/mcp',
    })
  }

  const linearApiKey = getString(input.config.apiKey)
  if (!linearApiKey) return undefined

  return {
    type: 'remote',
    url: 'https://mcp.linear.app/mcp',
    enabled: true,
    headers: {
      Authorization: `Bearer ${linearApiKey}`,
    },
    oauth: false,
  }
}

function buildCustomMcpServerConfig(input: {
  connectorId: string
  config: Record<string, unknown>
  gatewayTargets?: Record<string, GatewayTarget>
}): McpServerConfig | undefined {
  if (getConnectorAuthType(input.config) === 'oauth') {
    const oauth = getConnectorOAuthConfig('custom', input.config)
    if (!oauth?.accessToken) return undefined

    const endpoint = oauth.mcpServerUrl ?? getString(input.config.endpoint)
    if (!endpoint) return undefined

    const headers = toStringRecord(input.config.headers)
    const mergedHeaders = { ...(headers ?? {}) }
    const gatewayTarget = input.gatewayTargets?.[input.connectorId]

    if (gatewayTarget) {
      mergedHeaders.Authorization = `Bearer ${gatewayTarget.token}`
      return {
        type: 'remote',
        url: gatewayTarget.url,
        enabled: true,
        headers: mergedHeaders,
        oauth: false,
      }
    }

    mergedHeaders.Authorization = `Bearer ${oauth.accessToken}`
    return {
      type: 'remote',
      url: endpoint,
      enabled: true,
      headers: mergedHeaders,
      oauth: false,
    }
  }

  const endpoint = getString(input.config.endpoint)
  if (!endpoint) return undefined

  const headers = toStringRecord(input.config.headers)
  const auth = getString(input.config.auth)
  const mergedHeaders = { ...(headers ?? {}) }
  if (auth && !mergedHeaders.Authorization) {
    mergedHeaders.Authorization = `Bearer ${auth}`
  }

  return {
    type: 'remote',
    url: endpoint,
    enabled: true,
    headers: Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
    oauth: auth ? false : undefined,
  }
}

function buildEmbeddedConnectorMcpServerConfig(
  type: ConnectorType,
  config: Record<string, unknown>,
  gatewayTarget?: GatewayTarget,
): McpServerConfig | undefined {
  const parser = EMBEDDED_CONNECTOR_PARSERS[type]
  const parsed = parser?.(config)
  if (!parsed?.ok || !gatewayTarget) return undefined

  return buildGatewayRemoteMcpConfig(gatewayTarget)
}

function buildMetaAdsMcpServerConfig(
  config: Record<string, unknown>,
  gatewayTarget?: GatewayTarget,
): McpServerConfig | undefined {
  const parsed = parseMetaAdsConnectorConfig(config)
  if (!parsed.ok || !gatewayTarget) return undefined

  return buildGatewayRemoteMcpConfig(gatewayTarget)
}

function buildGoogleWorkspaceMcpServerConfig(input: {
  connectorId: string
  connectorType: ConnectorType
  config: Record<string, unknown>
  gatewayTargets?: Record<string, GatewayTarget>
}): McpServerConfig | undefined {
  if (!isGoogleWorkspaceConnectorType(input.connectorType)) return undefined
  if (getConnectorAuthType(input.config) !== 'oauth') return undefined

  return buildOAuthRemoteMcpConfig({
    connectorId: input.connectorId,
    connectorType: input.connectorType,
    config: input.config,
    gatewayTargets: input.gatewayTargets,
    defaultMcpUrl: getGoogleWorkspaceMcpServerUrl(input.connectorType),
  })
}

export function buildConnectorMcpServerConfig(input: {
  connectorId: string
  connectorType: ConnectorType
  config: Record<string, unknown>
  gatewayTargets?: Record<string, GatewayTarget>
}): McpServerConfig | undefined {
  switch (input.connectorType) {
    case 'notion':
      return buildNotionMcpServerConfig(input)
    case 'linear':
      return buildLinearMcpServerConfig(input)
    case 'custom':
      return buildCustomMcpServerConfig(input)
    case 'zendesk':
    case 'ahrefs':
    case 'umami':
      return buildEmbeddedConnectorMcpServerConfig(
        input.connectorType,
        input.config,
        input.gatewayTargets?.[input.connectorId],
      )
    case 'meta-ads':
      return buildMetaAdsMcpServerConfig(input.config, input.gatewayTargets?.[input.connectorId])
    default:
      return buildGoogleWorkspaceMcpServerConfig(input)
  }
}

export function shouldExposeConnectorViaGateway(type: ConnectorType, config: Record<string, unknown>): boolean {
  const parser = EMBEDDED_CONNECTOR_PARSERS[type]
  if (parser) return parser(config).ok

  if (type === 'meta-ads') {
    const parsed = parseMetaAdsConnectorConfig(config)
    const oauth = getConnectorOAuthConfig('meta-ads', config)
    return parsed.ok && Boolean(oauth?.accessToken) && isMetaAdsConnectorReady(config)
  }

  if (getConnectorAuthType(config) !== 'oauth') return false

  const oauth = getConnectorOAuthConfig(type, config)
  if (!oauth?.accessToken) return false

  return type !== 'custom' || Boolean(oauth.mcpServerUrl || getString(config.endpoint))
}
