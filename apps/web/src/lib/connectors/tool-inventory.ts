import { getAhrefsMcpTools, parseAhrefsConnectorConfig } from '@/lib/connectors/ahrefs'
import { getGithubMcpHeaders, parseGithubConnectorConfig } from '@/lib/connectors/github'
import { getMetaAdsMcpTools, parseMetaAdsConnectorConfig } from '@/lib/connectors/meta-ads'
import { getConnectorMcpServerUrl } from '@/lib/connectors/mcp/server-url'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import type { ConnectorType } from '@/lib/connectors/types'
import { getUmamiMcpTools, parseUmamiConnectorConfig } from '@/lib/connectors/umami'
import { getZendeskMcpTools, parseZendeskConnectorConfig } from '@/lib/connectors/zendesk'
import { isRecord } from '@/lib/records'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from '@/lib/sse-parser'

export type ConnectorToolInventoryItem = {
  name: string
  title: string
  description?: string
}

export type ConnectorToolInventoryResult =
  | { ok: true; tools: ConnectorToolInventoryItem[] }
  | { ok: false; tools: ConnectorToolInventoryItem[]; message: string }

const REMOTE_TOOL_LIST_TIMEOUT_MS = 8_000
const REMOTE_TOOL_LIST_MAX_RESPONSE_BYTES = 1024 * 1024

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
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...(toStringRecord(config.headers) ?? {}),
  }

  if (type === 'github') {
    const parsed = parseGithubConnectorConfig(config)
    if (!parsed.ok) return null

    return { ...headers, ...getGithubMcpHeaders(parsed.config) }
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

function parseRemoteToolsFromSse(value: string): ConnectorToolInventoryItem[] {
  const parsed = parseSseChunk(INITIAL_SSE_PARSE_STATE, `${value}\n\n`)

  for (const event of parsed.events) {
    let data: unknown
    try {
      data = JSON.parse(event.data)
    } catch {
      continue
    }

    const tools = parseRemoteTools(data)
    if (tools.length > 0) {
      return tools
    }
  }

  return []
}

async function readLimitedResponseText(
  response: Response,
): Promise<
  | { ok: true; text: string }
  | { ok: false; error: 'response_too_large' | 'unreadable_response' }
> {
  if (response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    let text = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      size += value.byteLength
      if (size > REMOTE_TOOL_LIST_MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return { ok: false, error: 'response_too_large' }
      }

      text += decoder.decode(value, { stream: true })
    }

    return { ok: true, text: `${text}${decoder.decode()}` }
  }

  if (typeof response.text === 'function') {
    const text = await response.text()
    return text.length > REMOTE_TOOL_LIST_MAX_RESPONSE_BYTES
      ? { ok: false, error: 'response_too_large' }
      : { ok: true, text }
  }

  return { ok: false, error: 'unreadable_response' }
}

function getResponseContentType(response: Response): string {
  const headers = response.headers
  return headers?.get?.('content-type')?.toLowerCase() ?? ''
}

async function readRemoteTools(
  response: Response,
): Promise<{ ok: true; tools: ConnectorToolInventoryItem[] } | { ok: false; message: string }> {
  const textResult = await readLimitedResponseText(response)
  if (!textResult.ok && textResult.error === 'response_too_large') {
    return { ok: false, message: 'Remote MCP server response was too large.' }
  }

  if (!textResult.ok) {
    const data = await response.json().catch(() => null)
    return { ok: true, tools: parseRemoteTools(data) }
  }

  const { text } = textResult
  if (getResponseContentType(response).includes('text/event-stream')) {
    return { ok: true, tools: parseRemoteToolsFromSse(text) }
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = await response.json().catch(() => null)
  }
  return { ok: true, tools: parseRemoteTools(data) }
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
  if (type === 'custom' || type === 'github') {
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

    const toolResult = await readRemoteTools(response)
    if (!toolResult.ok) {
      return { ok: false, tools: [], message: toolResult.message }
    }

    if (toolResult.tools.length === 0) {
      return { ok: false, tools: [], message: 'Remote MCP server returned no tools.' }
    }

    return { ok: true, tools: toolResult.tools }
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
