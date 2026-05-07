import { getAhrefsMcpTools, parseAhrefsConnectorConfig } from '@/lib/connectors/ahrefs'
import { getMetaAdsMcpTools, parseMetaAdsConnectorConfig } from '@/lib/connectors/meta-ads'
import { getConnectorMcpServerUrl } from '@/lib/connectors/mcp/server-url'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { isRecord } from '@/lib/records'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'
import { getUmamiMcpTools, parseUmamiConnectorConfig } from '@/lib/connectors/umami'
import type { ConnectorType } from '@/lib/connectors/types'
import { getZendeskMcpTools, parseZendeskConnectorConfig } from '@/lib/connectors/zendesk'

export type ConnectorToolInventoryItem = {
  name: string
  title: string
  description?: string
}

export type ConnectorToolInventoryResult =
  | { ok: true; tools: ConnectorToolInventoryItem[] }
  | { ok: false; tools: ConnectorToolInventoryItem[]; message: string }

const REMOTE_TOOL_LIST_TIMEOUT_MS = 8_000

function toToolTitle(name: string): string {
  const formatted = name.replace(/[_-]+/g, ' ').trim()
  return formatted ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : name
}

function toInventoryItem(tool: {
  name: string
  description?: string
}): ConnectorToolInventoryItem {
  return {
    name: tool.name,
    title: toToolTitle(tool.name),
    description: tool.description,
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined

  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      record[key] = entry
    }
  }

  return Object.keys(record).length > 0 ? record : undefined
}

function buildRemoteHeaders(
  type: ConnectorType,
  config: Record<string, unknown>,
): Record<string, string> | null {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(toStringRecord(config.headers) ?? {}),
  }

  if (getConnectorAuthType(config) === 'oauth') {
    const oauth = getConnectorOAuthConfig(type, config)
    if (!oauth?.accessToken) return null
    headers.Authorization = `Bearer ${oauth.accessToken}`
    return headers
  }

  const apiKey = getString(config.apiKey)
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    return headers
  }

  const auth = getString(config.auth)
  if (auth && !headers.Authorization) {
    headers.Authorization = `Bearer ${auth}`
  }

  return headers
}

function parseRemoteTools(value: unknown): ConnectorToolInventoryItem[] {
  if (!isRecord(value) || !isRecord(value.result) || !Array.isArray(value.result.tools)) {
    return []
  }

  return value.result.tools.flatMap((entry) => {
    if (!isRecord(entry)) return []

    const name = getString(entry.name)
    if (!name) return []

    return [
      toInventoryItem({
        name,
        description: getString(entry.description),
      }),
    ]
  })
}

async function loadRemoteConnectorToolInventory(
  type: ConnectorType,
  config: Record<string, unknown>,
): Promise<ConnectorToolInventoryResult> {
  const upstreamUrl = getConnectorMcpServerUrl(type, config)
  if (!upstreamUrl) {
    return { ok: false, tools: [], message: 'Connector does not expose a remote MCP endpoint.' }
  }

  let url: URL
  if (type === 'custom') {
    const endpointValidation = await validateConnectorTestEndpoint(upstreamUrl)
    if (!endpointValidation.ok) {
      return { ok: false, tools: [], message: 'Connector endpoint is not allowed.' }
    }

    url = endpointValidation.url
  } else {
    try {
      url = new URL(upstreamUrl)
    } catch {
      return { ok: false, tools: [], message: 'Connector endpoint is invalid.' }
    }
  }

  const headers = buildRemoteHeaders(type, config)
  if (!headers) {
    return { ok: false, tools: [], message: 'Connector is not authenticated.' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REMOTE_TOOL_LIST_TIMEOUT_MS)

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools-list',
        method: 'tools/list',
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return { ok: false, tools: [], message: 'Remote MCP server did not return tools.' }
    }

    const data = await response.json().catch(() => null)
    const tools = parseRemoteTools(data)
    if (tools.length === 0) {
      return { ok: false, tools: [], message: 'Remote MCP server returned no tools.' }
    }

    return { ok: true, tools }
  } catch {
    return { ok: false, tools: [], message: 'Remote MCP tools could not be loaded.' }
  } finally {
    clearTimeout(timeout)
  }
}

export async function loadConnectorToolInventory(input: {
  type: ConnectorType
  config: Record<string, unknown>
}): Promise<ConnectorToolInventoryResult> {
  switch (input.type) {
    case 'zendesk': {
      const parsed = parseZendeskConnectorConfig(input.config)
      if (!parsed.ok) return { ok: false, tools: [], message: 'Zendesk connector config is invalid.' }
      return { ok: true, tools: getZendeskMcpTools(parsed.value).map(toInventoryItem) }
    }
    case 'meta-ads': {
      const parsed = parseMetaAdsConnectorConfig(input.config)
      if (!parsed.ok) return { ok: false, tools: [], message: 'Meta Ads connector config is invalid.' }
      return { ok: true, tools: getMetaAdsMcpTools(parsed.value).map(toInventoryItem) }
    }
    case 'ahrefs': {
      const parsed = parseAhrefsConnectorConfig(input.config)
      if (!parsed.ok) return { ok: false, tools: [], message: 'Ahrefs connector config is invalid.' }
      return { ok: true, tools: getAhrefsMcpTools().map(toInventoryItem) }
    }
    case 'umami': {
      const parsed = parseUmamiConnectorConfig(input.config)
      if (!parsed.ok) return { ok: false, tools: [], message: 'Umami connector config is invalid.' }
      return { ok: true, tools: getUmamiMcpTools().map(toInventoryItem) }
    }
    default:
      return loadRemoteConnectorToolInventory(input.type, input.config)
  }
}
