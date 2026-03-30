import { decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorGatewayBaseUrl } from '@/lib/connectors/gateway-config'
import { issueConnectorGatewayToken } from '@/lib/connectors/gateway-tokens'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorConfig, validateConnectorType } from '@/lib/connectors/validators'

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

export type ConnectorRecord = {
  id: string
  type: string
  name: string
  enabled: boolean
  config: string
}

type GatewayTarget = {
  url: string
  token: string
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

export function buildMcpServerKey(type: ConnectorType, id: string): string {
  return `arche_${type}_${id}`
}

export function buildMcpConfigFromConnectors(
  connectors: ConnectorRecord[],
  options?: { oauthGatewayTargets?: Record<string, GatewayTarget> },
): McpConfig {
  const mcp: Record<string, McpServerConfig> = {}

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

    const key = buildMcpServerKey(connector.type, connector.id)

    switch (connector.type) {
      case 'notion':
        if (getConnectorAuthType(config) === 'oauth') {
          const gatewayTarget = options?.oauthGatewayTargets?.[connector.id]
          if (gatewayTarget) {
            mcp[key] = {
              type: 'remote',
              url: gatewayTarget.url,
              enabled: true,
              headers: {
                Authorization: `Bearer ${gatewayTarget.token}`,
              },
              oauth: false,
            }
            break
          }

          const oauthToken = getConnectorOAuthConfig('notion', config)?.accessToken
          if (!oauthToken) break
          mcp[key] = {
            type: 'remote',
            url: 'https://mcp.notion.com/mcp',
            enabled: true,
            headers: {
              Authorization: `Bearer ${oauthToken}`,
            },
            oauth: false,
          }
          break
        }

        const notionApiKey = getString(config.apiKey)
        if (!notionApiKey) break
        mcp[key] = {
          type: 'local',
          command: ['npx', '-y', '@suekou/mcp-notion-server'],
          enabled: true,
          environment: {
            NOTION_API_TOKEN: notionApiKey,
          },
        }
        break

      case 'linear':
        if (getConnectorAuthType(config) === 'oauth') {
          const gatewayTarget = options?.oauthGatewayTargets?.[connector.id]
          if (gatewayTarget) {
            mcp[key] = {
              type: 'remote',
              url: gatewayTarget.url,
              enabled: true,
              headers: {
                Authorization: `Bearer ${gatewayTarget.token}`,
              },
              oauth: false,
            }
            break
          }

          const oauthToken = getConnectorOAuthConfig('linear', config)?.accessToken
          if (!oauthToken) break
          mcp[key] = {
            type: 'remote',
            url: 'https://mcp.linear.app/mcp',
            enabled: true,
            headers: {
              Authorization: `Bearer ${oauthToken}`,
            },
            oauth: false,
          }
          break
        }

        const linearApiKey = getString(config.apiKey)
        if (!linearApiKey) break
        mcp[key] = {
          type: 'remote',
          url: 'https://mcp.linear.app/mcp',
          enabled: true,
          headers: {
            Authorization: `Bearer ${linearApiKey}`,
          },
          oauth: false,
        }
        break

      case 'custom': {
        if (getConnectorAuthType(config) === 'oauth') {
          const oauth = getConnectorOAuthConfig('custom', config)
          if (!oauth?.accessToken) break

          const endpoint = oauth.mcpServerUrl ?? getString(config.endpoint)
          if (!endpoint) break

          const headers = toStringRecord(config.headers)
          const mergedHeaders = { ...(headers ?? {}) }

          const gatewayTarget = options?.oauthGatewayTargets?.[connector.id]
          if (gatewayTarget) {
            mergedHeaders.Authorization = `Bearer ${gatewayTarget.token}`
            mcp[key] = {
              type: 'remote',
              url: gatewayTarget.url,
              enabled: true,
              headers: mergedHeaders,
              oauth: false,
            }
            break
          }

          mergedHeaders.Authorization = `Bearer ${oauth.accessToken}`
          mcp[key] = {
            type: 'remote',
            url: endpoint,
            enabled: true,
            headers: mergedHeaders,
            oauth: false,
          }
          break
        }

        const endpoint = getString(config.endpoint)
        if (!endpoint) break
        const headers = toStringRecord(config.headers)
        const auth = getString(config.auth)
        const mergedHeaders = { ...(headers ?? {}) }
        if (auth && !mergedHeaders.Authorization) {
          mergedHeaders.Authorization = `Bearer ${auth}`
        }

        mcp[key] = {
          type: 'remote',
          url: endpoint,
          enabled: true,
          headers: Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
          oauth: auth ? false : undefined,
        }
        break
      }

      default:
        break
    }
  }

  return { $schema: OPENCODE_CONFIG_SCHEMA, mcp }
}

export async function buildMcpConfigForSlug(slug: string): Promise<McpConfig | null> {
  const { userService, connectorService } = await import('@/lib/services')

  const user = await userService.findIdBySlug(slug)
  if (!user) return null

  const connectors = await connectorService.findEnabledMcpByUserId(user.id)

  const oauthGatewayTargets: Record<string, GatewayTarget> = {}
  const gatewayBase = getConnectorGatewayBaseUrl()

  for (const connector of connectors) {
    if (!validateConnectorType(connector.type)) continue

    let config: Record<string, unknown>
    try {
      config = decryptConfig(connector.config)
    } catch {
      continue
    }

    if (getConnectorAuthType(config) !== 'oauth') continue
    const oauth = getConnectorOAuthConfig(connector.type, config)
    if (!oauth?.accessToken) continue

    if (connector.type === 'custom' && !oauth.mcpServerUrl && !getString(config.endpoint)) {
      continue
    }

    oauthGatewayTargets[connector.id] = {
      url: `${gatewayBase}/${connector.id}/mcp`,
      token: issueConnectorGatewayToken({
        userId: user.id,
        workspaceSlug: slug,
        connectorId: connector.id,
      }),
    }
  }

  const config = buildMcpConfigFromConnectors(connectors, {
    oauthGatewayTargets,
  })
  return Object.keys(config.mcp).length ? config : null
}
