import { join } from 'node:path'

import { loadDefinitions } from '@/kickstart/definition-loader'
import {
  hasOnlyAllowedKeys,
  isRecord,
  parseNonEmptyString,
  parseOrder,
} from '@/kickstart/parse-utils'
import type { KickstartAgentDefinition, KickstartAgentSummary } from '@/kickstart/types'
import {
  OPENCODE_AGENT_TOOLS,
  type OpenCodeAgentToolId,
} from '@/lib/agent-capabilities'

type ParsedAgentDefinition = {
  definition: KickstartAgentDefinition
  order: number
}

const AGENT_DEFINITION_KEYS = new Set([
  'id',
  'displayName',
  'description',
  'systemPrompt',
  'recommendedModel',
  'temperature',
  'tools',
  'order',
])

const AGENT_DEFINITION_DIR_CANDIDATES = [
  join(process.cwd(), 'kickstart/agents/definitions'),
  join(process.cwd(), 'apps/web/kickstart/agents/definitions'),
]

const AGENT_TOOL_SET = new Set<string>(OPENCODE_AGENT_TOOLS)

function isOpenCodeAgentToolId(value: string): value is OpenCodeAgentToolId {
  return AGENT_TOOL_SET.has(value)
}

function parseSystemPrompt(value: unknown, fileName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid systemPrompt in kickstart agent definition: ${fileName}`)
  }

  return value
}

function parseTemperature(value: unknown, fileName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(`Invalid temperature in kickstart agent definition: ${fileName}`)
  }

  return value
}

function parseTools(value: unknown, fileName: string): OpenCodeAgentToolId[] {
  if (value === 'all') {
    return [...OPENCODE_AGENT_TOOLS]
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid tools in kickstart agent definition: ${fileName}`)
  }

  const tools: OpenCodeAgentToolId[] = []
  const seen = new Set<OpenCodeAgentToolId>()

  for (const item of value) {
    if (typeof item !== 'string' || !isOpenCodeAgentToolId(item)) {
      throw new Error(`Unknown tool in kickstart agent definition: ${fileName}`)
    }

    if (seen.has(item)) {
      continue
    }

    seen.add(item)
    tools.push(item)
  }

  return tools
}

function parseAgentDefinition(raw: string, fileName: string): ParsedAgentDefinition {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in kickstart agent definition: ${fileName}`)
  }

  if (!isRecord(parsedValue) || !hasOnlyAllowedKeys(parsedValue, AGENT_DEFINITION_KEYS)) {
    throw new Error(`Invalid object shape in kickstart agent definition: ${fileName}`)
  }

  const context = `kickstart agent definition: ${fileName}`

  const definition: KickstartAgentDefinition = {
    id: parseNonEmptyString(parsedValue.id, 'id', context),
    displayName: parseNonEmptyString(parsedValue.displayName, 'displayName', context),
    description: parseNonEmptyString(parsedValue.description, 'description', context),
    systemPrompt: parseSystemPrompt(parsedValue.systemPrompt, fileName),
    recommendedModel: parseNonEmptyString(
      parsedValue.recommendedModel,
      'recommendedModel',
      context
    ),
    temperature: parseTemperature(parsedValue.temperature, fileName),
    tools: parseTools(parsedValue.tools, fileName),
  }

  return {
    definition,
    order: parseOrder(parsedValue.order, context),
  }
}

function loadKickstartAgentCatalog(): KickstartAgentDefinition[] {
  return loadDefinitions({
    directoryCandidates: AGENT_DEFINITION_DIR_CANDIDATES,
    definitionKind: 'Kickstart agent',
    idKind: 'agent',
    parse: parseAgentDefinition,
  })
}

export const KICKSTART_AGENT_CATALOG: KickstartAgentDefinition[] =
  loadKickstartAgentCatalog()

export const KICKSTART_AGENT_BY_ID = new Map(
  KICKSTART_AGENT_CATALOG.map((agent) => [agent.id, agent])
)

export function getKickstartAgentById(id: string): KickstartAgentDefinition | null {
  return KICKSTART_AGENT_BY_ID.get(id) ?? null
}

const KICKSTART_AGENT_SUMMARIES: KickstartAgentSummary[] = KICKSTART_AGENT_CATALOG

export function getKickstartAgentSummaries(): KickstartAgentSummary[] {
  return KICKSTART_AGENT_SUMMARIES
}
