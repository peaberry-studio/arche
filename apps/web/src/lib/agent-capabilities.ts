import {
  CONNECTOR_TYPES,
  isSingleInstanceConnectorType,
  type ConnectorType,
} from '@/lib/connectors/types'
import { isRecord } from '@/lib/records'
import { SKILL_NAME_PATTERN } from '@/lib/skills/types'

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
  'document_inspect',
  'presentation_inspect',
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
  { id: 'document_inspect', label: 'Inspect documents' },
  { id: 'presentation_inspect', label: 'Inspect presentations' },
  { id: 'spreadsheet_inspect', label: 'Inspect spreadsheets' },
  { id: 'spreadsheet_sample', label: 'Sample spreadsheet rows' },
  { id: 'spreadsheet_query', label: 'Query spreadsheet data' },
  { id: 'spreadsheet_stats', label: 'Spreadsheet statistics' },
]

export type AgentCapabilities = {
  skillIds: string[]
  tools: OpenCodeAgentToolId[]
  mcpConnectorIds: string[]
}

export type ConnectorCapabilityRecord = {
  id: string
  type: ConnectorType
}

const SINGLE_INSTANCE_AGENT_CONNECTOR_CAPABILITY_IDS = {
  linear: 'globallinear',
  'meta-ads': 'globalmetaads',
  notion: 'globalnotion',
  zendesk: 'globalzendesk',
  ahrefs: 'globalahrefs',
  umami: 'globalumami',
  google_gmail: 'globalgooglegmail',
  google_drive: 'globalgoogledrive',
  google_calendar: 'globalgooglecalendar',
  google_chat: 'globalgooglechat',
  google_people: 'globalgooglepeople',
} as const satisfies Record<Exclude<ConnectorType, 'custom'>, string>

const TOOL_SET = new Set<string>(OPENCODE_AGENT_TOOLS)
const CONNECTOR_TYPE_PATTERN = CONNECTOR_TYPES.join('|')
export const MCP_TOOL_PATTERN = new RegExp(`^arche_(${CONNECTOR_TYPE_PATTERN})_([a-z0-9]+)_\\*$`)

function buildMcpServerKey(type: ConnectorType, id: string): string {
  return `arche_${type}_${id}`
}

export function getConnectorCapabilityId(type: ConnectorType, id: string): string {
  if (type === 'custom') {
    return id
  }

  return isSingleInstanceConnectorType(type)
    ? SINGLE_INSTANCE_AGENT_CONNECTOR_CAPABILITY_IDS[type]
    : id
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function isPermissionValue(value: unknown): value is 'allow' | 'ask' | 'deny' {
  return value === 'allow' || value === 'ask' || value === 'deny'
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

export function validateAgentCapabilitySkillIds(value: unknown): {
  ok: true
  skillIds: string[]
} | {
  ok: false
  error: string
} {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'invalid_skill_ids' }
  }

  const skillIds: string[] = []
  for (const skillId of value) {
    if (typeof skillId !== 'string') {
      return { ok: false, error: 'invalid_skill_ids' }
    }

    const normalized = skillId.trim()
    if (!normalized || normalized.length > 64 || !SKILL_NAME_PATTERN.test(normalized)) {
      return { ok: false, error: 'invalid_skill_ids' }
    }

    skillIds.push(normalized)
  }

  return { ok: true, skillIds: uniqueSorted(skillIds) }
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

  toolConfig.skill = capabilities.skillIds.length > 0

  toolConfig['arche_*'] = false

  const connectorById = new Map(connectors.map((connector) => [connector.id, connector]))
  for (const connectorId of capabilities.mcpConnectorIds) {
    const connector = connectorById.get(connectorId)
    if (!connector) continue
    const serverKey = buildMcpServerKey(connector.type, connector.id)
    toolConfig[`${serverKey}_*`] = true
  }

  return toolConfig
}

export function extractAgentCapabilitiesFromTools(
  tools: Record<string, boolean> | undefined,
  permission?: unknown,
): AgentCapabilities {
  if (!tools) {
    return {
      skillIds: [],
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
      const [, type, connectorId] = match
      return [getConnectorCapabilityId(type as ConnectorType, connectorId)]
    })

  let skillIds: string[] = []
  if (tools.skill === true && isRecord(permission) && isRecord(permission.skill)) {
    skillIds = Object.entries(permission.skill)
      .filter(([name, value]) => name !== '*' && isPermissionValue(value) && value === 'allow')
      .map(([name]) => name)
  }

  return {
    skillIds: uniqueSorted(skillIds),
    tools: uniqueSorted(enabledTools) as OpenCodeAgentToolId[],
    mcpConnectorIds: uniqueSorted(connectorIds),
  }
}

export function buildAgentPermissionConfigFromCapabilities(
  capabilities: AgentCapabilities,
  existingPermission: unknown,
): Record<string, unknown> | undefined {
  const nextPermission = isRecord(existingPermission)
    ? { ...existingPermission }
    : {}

  if (capabilities.skillIds.length === 0) {
    delete nextPermission.skill
    return Object.keys(nextPermission).length > 0 ? nextPermission : undefined
  }

  nextPermission.skill = {
    '*': 'deny',
    ...Object.fromEntries(capabilities.skillIds.map((skillId) => [skillId, 'allow'] as const)),
  }

  return nextPermission
}
