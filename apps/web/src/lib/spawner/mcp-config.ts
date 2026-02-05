import { decryptConfig } from '@/lib/connectors/crypto'
import { validateConnectorConfig, validateConnectorType } from '@/lib/connectors/validators'
import type { ConnectorType } from '@/lib/connectors/types'

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

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') record[key] = entry
  }
  return Object.keys(record).length ? record : undefined
}

function buildKey(type: ConnectorType, id: string): string {
  return `arche_${type}_${id}`
}

export function buildMcpConfigFromConnectors(connectors: ConnectorRecord[]): McpConfig {
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

    const key = buildKey(connector.type, connector.id)

    switch (connector.type) {
      case 'github':
        const token = getString(config.token)
        if (!token) break
        mcp[key] = {
          type: 'local',
          command: ['npx', '-y', '@modelcontextprotocol/server-github'],
          enabled: true,
          environment: {
            GITHUB_PERSONAL_ACCESS_TOKEN: token,
          },
        }
        break

      case 'notion':
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

      case 'slack': {
        const botToken = getString(config.botToken)
        const teamId = getString(config.teamId)
        if (!botToken || !teamId) break
        const environment: Record<string, string> = {
          SLACK_BOT_TOKEN: botToken,
          SLACK_TEAM_ID: teamId,
        }
        const appToken = getString(config.appToken)
        if (appToken) environment.SLACK_APP_TOKEN = appToken

        mcp[key] = {
          type: 'local',
          command: ['npx', '-y', '@modelcontextprotocol/server-slack'],
          enabled: true,
          environment,
        }
        break
      }

      case 'linear':
        const linearApiKey = getString(config.apiKey)
        if (!linearApiKey) break
        mcp[key] = {
          type: 'local',
          command: ['npx', '-y', 'linear-mcp-server'],
          enabled: true,
          environment: {
            LINEAR_API_KEY: linearApiKey,
          },
        }
        break

      case 'custom': {
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
  const { prisma } = await import('@/lib/prisma')

  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!user) return null

  const connectors = await prisma.connector.findMany({
    where: { userId: user.id, enabled: true },
    select: { id: true, type: true, name: true, config: true, enabled: true },
  })

  const config = buildMcpConfigFromConnectors(connectors)
  return Object.keys(config.mcp).length ? config : null
}
