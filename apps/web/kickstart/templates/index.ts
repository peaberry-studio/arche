import { join } from 'node:path'

import { loadDefinitions } from '@/kickstart/definition-loader'
import {
  hasOnlyAllowedKeys,
  isRecord,
  parseNonEmptyString,
  parseOrder,
} from '@/kickstart/parse-utils'
import type {
  KickstartKbSkeletonEntry,
  KickstartTemplateDefinition,
  KickstartTemplateSummary,
} from '@/kickstart/types'

type ParsedTemplateDefinition = {
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
  'recommendedModels',
  'order',
])

const KB_SKELETON_DIR_KEYS = new Set(['type', 'path'])
const KB_SKELETON_FILE_KEYS = new Set(['type', 'path', 'content'])

const TEMPLATE_DEFINITION_DIR_CANDIDATES = [
  join(process.cwd(), 'kickstart/templates/definitions'),
  join(process.cwd(), 'apps/web/kickstart/templates/definitions'),
]

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
    if (seenIds.has(parsedAgentId)) {
      continue
    }

    seenIds.add(parsedAgentId)
    recommendedAgentIds.push(parsedAgentId)
  }

  return recommendedAgentIds
}

function parseRecommendedModels(
  value: unknown,
  recommendedAgentIds: string[],
  fileName: string
): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`Invalid recommendedModels in kickstart template definition: ${fileName}`)
  }

  const recommendedModels: Record<string, string> = {}
  const context = `kickstart template definition: ${fileName}`

  for (const [agentId, model] of Object.entries(value)) {
    recommendedModels[agentId] = parseNonEmptyString(model, 'recommendedModels', context)
  }

  for (const recommendedAgentId of recommendedAgentIds) {
    if (!recommendedModels[recommendedAgentId]) {
      throw new Error(
        `Missing recommended model for agent ${recommendedAgentId} in ${fileName}`
      )
    }
  }

  return recommendedModels
}

function parseTemplateDefinition(raw: string, fileName: string): ParsedTemplateDefinition {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in kickstart template definition: ${fileName}`)
  }

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
    recommendedModels: parseRecommendedModels(
      parsedValue.recommendedModels,
      recommendedAgentIds,
      fileName
    ),
  }

  return {
    definition,
    order: parseOrder(parsedValue.order, context),
  }
}

function loadKickstartTemplates(): KickstartTemplateDefinition[] {
  return loadDefinitions({
    directoryCandidates: TEMPLATE_DEFINITION_DIR_CANDIDATES,
    definitionKind: 'Kickstart template',
    idKind: 'template',
    parse: parseTemplateDefinition,
  })
}

export const KICKSTART_TEMPLATES: KickstartTemplateDefinition[] = loadKickstartTemplates()

const templateMap = new Map(
  KICKSTART_TEMPLATES.map((template) => [template.id, template])
)

export function getKickstartTemplateById(
  templateId: string
): KickstartTemplateDefinition | null {
  return templateMap.get(templateId) ?? null
}

const KICKSTART_TEMPLATE_SUMMARIES: KickstartTemplateSummary[] = KICKSTART_TEMPLATES.map(
  (template) => ({
    id: template.id,
    label: template.label,
    description: template.description,
    recommendedAgentIds: template.recommendedAgentIds,
    recommendedModels: template.recommendedModels,
  })
)

export function getKickstartTemplateSummaries(): KickstartTemplateSummary[] {
  return KICKSTART_TEMPLATE_SUMMARIES
}
