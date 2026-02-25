import { getKickstartAgentById } from '@/kickstart/agents/catalog'
import {
  hasOnlyAllowedKeys,
  isRecord,
  parseNonEmptyString,
  parseOrder,
} from '@/kickstart/parse-utils'
import type {
  KickstartKbSkeletonEntry,
  KickstartTemplateAgentOverride,
  KickstartTemplateDefinition,
} from '@/kickstart/types'

export type ParsedTemplateDefinition = {
  definition: KickstartTemplateDefinition
  order: number
}

const TEMPLATE_DEFINITION_KEYS = new Set([
  'id',
  'label',
  'description',
  'kbSkeleton',
  'agentsMdTemplate',
  'recommendedAgentIds',
  'agentOverrides',
  'order',
])

const AGENT_OVERRIDE_KEYS = new Set(['model', 'prompt'])
const KB_SKELETON_DIR_KEYS = new Set(['type', 'path'])
const KB_SKELETON_FILE_KEYS = new Set(['type', 'path', 'content'])
const CORE_AGENT_PROMPT_OVERRIDE_BLOCKLIST = new Set(['assistant', 'knowledge-curator'])

function parseTemplateMarkdown(value: unknown, fieldName: string, fileName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${fieldName} in kickstart template definition: ${fileName}`)
  }

  return value
}

function parseKbSkeleton(value: unknown, fileName: string): KickstartKbSkeletonEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid kbSkeleton in kickstart template definition: ${fileName}`)
  }

  const entries: KickstartKbSkeletonEntry[] = []
  const context = `kickstart template definition: ${fileName}`

  for (const entry of value) {
    if (!isRecord(entry)) {
      throw new Error(`Invalid kbSkeleton entry in kickstart template definition: ${fileName}`)
    }

    if (entry.type === 'dir') {
      if (!hasOnlyAllowedKeys(entry, KB_SKELETON_DIR_KEYS)) {
        throw new Error(`Invalid kbSkeleton dir shape in kickstart template definition: ${fileName}`)
      }

      entries.push({
        type: 'dir',
        path: parseNonEmptyString(entry.path, 'kbSkeleton.path', context),
      })
      continue
    }

    if (entry.type === 'file') {
      if (!hasOnlyAllowedKeys(entry, KB_SKELETON_FILE_KEYS)) {
        throw new Error(`Invalid kbSkeleton file shape in kickstart template definition: ${fileName}`)
      }

      if (typeof entry.content !== 'string') {
        throw new Error(`Invalid kbSkeleton content in kickstart template definition: ${fileName}`)
      }

      entries.push({
        type: 'file',
        path: parseNonEmptyString(entry.path, 'kbSkeleton.path', context),
        content: entry.content,
      })
      continue
    }

    throw new Error(`Invalid kbSkeleton type in kickstart template definition: ${fileName}`)
  }

  return entries
}

function parseRecommendedAgentIds(value: unknown, fileName: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid recommendedAgentIds in kickstart template definition: ${fileName}`)
  }

  const recommendedAgentIds: string[] = []
  const seenIds = new Set<string>()
  const context = `kickstart template definition: ${fileName}`

  for (const agentId of value) {
    const parsedAgentId = parseNonEmptyString(agentId, 'recommendedAgentIds', context)

    if (!getKickstartAgentById(parsedAgentId)) {
      throw new Error(
        `Unknown agent id in recommendedAgentIds (${parsedAgentId}) in kickstart template definition: ${fileName}`
      )
    }

    if (seenIds.has(parsedAgentId)) {
      continue
    }

    seenIds.add(parsedAgentId)
    recommendedAgentIds.push(parsedAgentId)
  }

  return recommendedAgentIds
}

function parseAgentOverrides(
  value: unknown,
  fileName: string
): Record<string, KickstartTemplateAgentOverride> {
  if (!isRecord(value)) {
    throw new Error(`Invalid agentOverrides in kickstart template definition: ${fileName}`)
  }

  const context = `kickstart template definition: ${fileName}`
  const agentOverrides: Record<string, KickstartTemplateAgentOverride> = {}

  for (const [agentId, override] of Object.entries(value)) {
    const parsedAgentId = parseNonEmptyString(agentId, 'agentOverrides key', context)

    if (!getKickstartAgentById(parsedAgentId)) {
      throw new Error(
        `Unknown agent id in agentOverrides (${parsedAgentId}) in kickstart template definition: ${fileName}`
      )
    }

    if (!isRecord(override) || !hasOnlyAllowedKeys(override, AGENT_OVERRIDE_KEYS)) {
      throw new Error(`Invalid agentOverrides entry shape in kickstart template definition: ${fileName}`)
    }

    const parsedOverride: KickstartTemplateAgentOverride = {}

    if (override.model !== undefined) {
      parsedOverride.model = parseNonEmptyString(override.model, 'agentOverrides.model', context)
    }

    if (override.prompt !== undefined) {
      if (CORE_AGENT_PROMPT_OVERRIDE_BLOCKLIST.has(parsedAgentId)) {
        throw new Error(
          `Prompt overrides are not allowed for core agent ${parsedAgentId} in ${fileName}`
        )
      }

      parsedOverride.prompt = parseTemplateMarkdown(override.prompt, 'agentOverrides.prompt', fileName)
    }

    if (!parsedOverride.model && !parsedOverride.prompt) {
      throw new Error(`Invalid agentOverrides entry in kickstart template definition: ${fileName}`)
    }

    agentOverrides[parsedAgentId] = parsedOverride
  }

  return agentOverrides
}

export function parseKickstartTemplateDefinitionValue(
  parsedValue: unknown,
  fileName: string
): ParsedTemplateDefinition {
  if (!isRecord(parsedValue) || !hasOnlyAllowedKeys(parsedValue, TEMPLATE_DEFINITION_KEYS)) {
    throw new Error(`Invalid object shape in kickstart template definition: ${fileName}`)
  }

  const recommendedAgentIds = parseRecommendedAgentIds(parsedValue.recommendedAgentIds, fileName)
  const context = `kickstart template definition: ${fileName}`

  const definition: KickstartTemplateDefinition = {
    id: parseNonEmptyString(parsedValue.id, 'id', context),
    label: parseNonEmptyString(parsedValue.label, 'label', context),
    description: parseNonEmptyString(parsedValue.description, 'description', context),
    kbSkeleton: parseKbSkeleton(parsedValue.kbSkeleton, fileName),
    agentsMdTemplate: parseTemplateMarkdown(parsedValue.agentsMdTemplate, 'agentsMdTemplate', fileName),
    recommendedAgentIds,
    agentOverrides: parseAgentOverrides(parsedValue.agentOverrides, fileName),
  }

  return {
    definition,
    order: parseOrder(parsedValue.order, context),
  }
}

export function parseKickstartTemplateDefinitionRaw(
  raw: string,
  fileName: string
): ParsedTemplateDefinition {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in kickstart template definition: ${fileName}`)
  }

  return parseKickstartTemplateDefinitionValue(parsedValue, fileName)
}
