import { decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorGatewayBaseUrl } from '@/lib/connectors/gateway-config'
import { issueConnectorGatewayToken } from '@/lib/connectors/gateway-tokens'
import { isConnectorCapabilityAvailable } from '@/lib/connectors/require-connector-capability'
import {
  getStoredConnectorToolPermissions,
  type ConnectorToolPermissionMap,
} from '@/lib/connectors/tool-permissions'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorConfig, validateConnectorType } from '@/lib/connectors/validators'
import {
  buildConnectorMcpServerConfig,
  shouldExposeConnectorViaGateway,
} from '@/lib/spawner/mcp-connector-config'

const OPENCODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json'

export type McpServerConfig = {
  type: 'local' | 'remote'
  command?: string[]
  url?: string
  enabled?: boolean
  environment?: Record<string, string>
  headers?: Record<string, string>
  oauth?: false
}

export type McpConfig = {
  $schema: string
  mcp: Record<string, McpServerConfig>
}

export type McpConfigBuildResult = {
  connectorAliases: Record<string, string>
  connectorDisplayNames: Record<string, string>
  mcpConfig: McpConfig
  connectorToolPermissions: Record<string, ConnectorToolPermissionMap>
}

export type ConnectorRecord = {
  id: string
  type: string
  name: string
  enabled: boolean
  config: string
}

export type GatewayTarget = {
  url: string
  token: string
}

export function buildMcpServerKey(type: ConnectorType, id: string): string {
  return `arche_${type}_${id}`
}

export function buildMcpConfigFromConnectors(
  connectors: ConnectorRecord[],
  options?: { gatewayTargets?: Record<string, GatewayTarget> },
): McpConfigBuildResult {
  const connectorAliases: Record<string, string> = {}
  const connectorDisplayNames: Record<string, string> = {}
  const mcp: Record<string, McpServerConfig> = {}
  const connectorToolPermissions: Record<string, ConnectorToolPermissionMap> = {}

  for (const connector of connectors) {
    if (!connector.enabled) continue
    if (!validateConnectorType(connector.type)) continue

    let config: Record<string, unknown>
    try {
      config = decryptConfig(connector.config)
    } catch {
      continue
    }

    const validation = validateConnectorConfig(connector.type, config)
    if (!validation.valid) continue

    const serverConfig = buildConnectorMcpServerConfig({
      connectorId: connector.id,
      connectorType: connector.type,
      config,
      gatewayTargets: options?.gatewayTargets,
    })
    if (serverConfig) {
      const serverKey = buildMcpServerKey(connector.type, connector.id)
      mcp[serverKey] = serverConfig
      connectorDisplayNames[serverKey] = connector.name.trim() || connector.id

      const toolPermissions = getStoredConnectorToolPermissions(config)
      if (toolPermissions) {
        connectorToolPermissions[serverKey] = toolPermissions
      }
    }
  }

  return {
    connectorAliases,
    connectorDisplayNames,
    mcpConfig: {
      $schema: OPENCODE_CONFIG_SCHEMA,
      mcp,
    },
    connectorToolPermissions,
  }
}

function buildCustomConnectorAliases(input: {
  sourceConnectors: Array<{ id: string; name: string; type: string }>
  userConnectors: ConnectorRecord[]
}): Record<string, string> {
  const aliases: Record<string, string> = {}
  const userCustomIdsByName = new Map<string, string[]>()

  const userCustomConnectors = input.userConnectors
    .filter((connector) => connector.type === 'custom')
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))

  for (const connector of userCustomConnectors) {
    const name = connector.name.trim()
    if (!name) continue

    const ids = userCustomIdsByName.get(name) ?? []
    ids.push(connector.id)
    userCustomIdsByName.set(name, ids)
  }

  if (userCustomIdsByName.size === 0) return aliases

  for (const connector of input.sourceConnectors) {
    if (connector.type !== 'custom') continue

    const userConnectorIds = userCustomIdsByName.get(connector.name.trim()) ?? []
    if (userConnectorIds.length !== 1) continue

    const userConnectorId = userConnectorIds[0]
    if (!userConnectorId || userConnectorId === connector.id) continue

    aliases[buildMcpServerKey('custom', connector.id)] = buildMcpServerKey('custom', userConnectorId)
  }

  return aliases
}

export async function buildMcpConfigForSlug(slug: string): Promise<McpConfigBuildResult | null> {
  const { userService, connectorService } = await import('@/lib/services')

  const user = await userService.findIdBySlug(slug)
  if (!user) return null

  const connectors = await connectorService.findEnabledMcpByUserId(user.id)

  const gatewayTargets: Record<string, GatewayTarget> = {}
  const gatewayBase = getConnectorGatewayBaseUrl()

  for (const connector of connectors) {
    if (!validateConnectorType(connector.type)) continue
    if (!isConnectorCapabilityAvailable(connector.type)) continue

    let config: Record<string, unknown>
    try {
      config = decryptConfig(connector.config)
    } catch {
      continue
    }

    if (!shouldExposeConnectorViaGateway(connector.type, config)) continue

    gatewayTargets[connector.id] = {
      url: `${gatewayBase}/${connector.id}/mcp`,
      token: issueConnectorGatewayToken({
        userId: user.id,
        workspaceSlug: slug,
        connectorId: connector.id,
      }),
    }
  }

  const result = buildMcpConfigFromConnectors(connectors, {
    gatewayTargets,
  })
  if (Object.keys(result.mcpConfig.mcp).length === 0) return null

  const sourceCustomConnectors = connectors.some((connector) => connector.type === 'custom')
    ? await connectorService.findNameEntriesByType('custom')
    : []
  result.connectorAliases = buildCustomConnectorAliases({
    sourceConnectors: sourceCustomConnectors,
    userConnectors: connectors,
  })
  return result
}
