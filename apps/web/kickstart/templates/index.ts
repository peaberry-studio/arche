import { join } from 'node:path'

import { loadDefinitions } from '@/kickstart/definition-loader'
import { parseKickstartTemplateDefinitionRaw } from '@/kickstart/templates/definition-parser'
import type {
  KickstartTemplateDefinition,
  KickstartTemplateSummary,
} from '@/kickstart/types'

const TEMPLATE_DEFINITION_DIR_CANDIDATES = [
  join(process.cwd(), 'kickstart/templates/definitions'),
  join(process.cwd(), 'apps/web/kickstart/templates/definitions'),
]

function loadKickstartTemplates(): KickstartTemplateDefinition[] {
  return loadDefinitions({
    directoryCandidates: TEMPLATE_DEFINITION_DIR_CANDIDATES,
    definitionKind: 'Kickstart template',
    idKind: 'template',
    parse: parseKickstartTemplateDefinitionRaw,
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
    recommendedAgentIds: [...template.recommendedAgentIds],
    agentOverrides: Object.fromEntries(
      Object.entries(template.agentOverrides).map(([agentId, override]) => [
        agentId,
        { ...override },
      ])
    ),
  })
)

export function getKickstartTemplateSummaries(): KickstartTemplateSummary[] {
  return KICKSTART_TEMPLATE_SUMMARIES
}
