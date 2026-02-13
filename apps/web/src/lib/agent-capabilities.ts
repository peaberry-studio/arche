import type { ConnectorType } from '@/lib/connectors/types'

export const OPENCODE_AGENT_TOOLS = [
  'write',
  'edit',
  'read',
  'list',
  'glob',
  'grep',
  'bash',
  'task',
  'webfetch',
  'websearch',
  'codesearch',
  'lsp',
  'todoread',
  'todowrite',
  'spreadsheet_inspect',
  'spreadsheet_sample',
  'spreadsheet_query',
  'spreadsheet_stats',
] as const

export type OpenCodeAgentToolId = (typeof OPENCODE_AGENT_TOOLS)[number]

export const OPENCODE_AGENT_TOOL_OPTIONS: Array<{
  id: OpenCodeAgentToolId
  label: string
}> = [
  { id: 'write', label: 'Write files' },
  { id: 'edit', label: 'Edit files' },
  { id: 'read', label: 'Read files' },
  { id: 'list', label: 'List directories' },
  { id: 'glob', label: 'Glob files' },
  { id: 'grep', label: 'Search content' },
  { id: 'bash', label: 'Run shell commands' },
  { id: 'task', label: 'Run subagents' },
  { id: 'webfetch', label: 'Fetch URLs' },
  { id: 'websearch', label: 'Web search' },
  { id: 'codesearch', label: 'Code search' },
  { id: 'lsp', label: 'Language server queries' },
  { id: 'todoread', label: 'Read todo list' },
  { id: 'todowrite', label: 'Update todo list' },
  { id: 'spreadsheet_inspect', label: 'Inspect spreadsheets' },
  { id: 'spreadsheet_sample', label: 'Sample spreadsheet rows' },
  { id: 'spreadsheet_query', label: 'Query spreadsheet data' },
  { id: 'spreadsheet_stats', label: 'Spreadsheet statistics' },
]

export type AgentCapabilities = {
  tools: OpenCodeAgentToolId[]
  mcpConnectorIds: string[]
}

export type ConnectorCapabilityRecord = {
  id: string
  type: ConnectorType
  enabled: boolean
}

const TOOL_SET = new Set<string>(OPENCODE_AGENT_TOOLS)
const MCP_TOOL_PATTERN = /^arche_(linear|notion|custom)_([a-z0-9]+)_\*$/

function buildMcpServerKey(type: ConnectorType, id: string): string {
  return `arche_${type}_${id}`
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

export function validateAgentCapabilityTools(value: unknown): {
  ok: true
  tools: OpenCodeAgentToolId[]
} | {
  ok: false
  error: string
} {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'invalid_tools' }
  }

  const tools: OpenCodeAgentToolId[] = []
  for (const tool of value) {
    if (typeof tool !== 'string' || !TOOL_SET.has(tool)) {
      return { ok: false, error: 'invalid_tools' }
    }
    tools.push(tool as OpenCodeAgentToolId)
  }

  const uniqueTools = uniqueSorted(tools) as OpenCodeAgentToolId[]
  return { ok: true, tools: uniqueTools }
}

export function validateAgentCapabilityConnectorIds(value: unknown): {
  ok: true
  connectorIds: string[]
} | {
  ok: false
  error: string
} {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'invalid_mcp_connector_ids' }
  }

  const connectorIds: string[] = []
  for (const connectorId of value) {
    if (typeof connectorId !== 'string' || !connectorId.trim()) {
      return { ok: false, error: 'invalid_mcp_connector_ids' }
    }
    connectorIds.push(connectorId.trim())
  }

  return { ok: true, connectorIds: uniqueSorted(connectorIds) }
}

export function buildAgentToolsConfigFromCapabilities(
  capabilities: AgentCapabilities,
  connectors: ConnectorCapabilityRecord[]
): Record<string, boolean> {
  const toolConfig: Record<string, boolean> = {}
  const enabledTools = new Set<string>(capabilities.tools)

  for (const toolId of OPENCODE_AGENT_TOOLS) {
    toolConfig[toolId] = enabledTools.has(toolId)
  }

  toolConfig['arche_*'] = false

  const connectorById = new Map(connectors.map((connector) => [connector.id, connector]))
  for (const connectorId of capabilities.mcpConnectorIds) {
    const connector = connectorById.get(connectorId)
    if (!connector || !connector.enabled) continue
    const serverKey = buildMcpServerKey(connector.type, connector.id)
    toolConfig[`${serverKey}_*`] = true
  }

  return toolConfig
}

export function extractAgentCapabilitiesFromTools(
  tools: Record<string, boolean> | undefined
): AgentCapabilities {
  if (!tools) {
    return {
      tools: [],
      mcpConnectorIds: [],
    }
  }

  const enabledTools = OPENCODE_AGENT_TOOLS.filter((toolId) => tools[toolId] === true)
  const connectorIds = Object.entries(tools)
    .filter(([, enabled]) => enabled)
    .flatMap(([toolId]) => {
      const match = toolId.match(MCP_TOOL_PATTERN)
      if (!match) return []
      return [match[2]]
    })

  return {
    tools: uniqueSorted(enabledTools) as OpenCodeAgentToolId[],
    mcpConnectorIds: uniqueSorted(connectorIds),
  }
}
