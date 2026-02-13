import type {
  KickstartTemplateDefinition,
  KickstartTemplateSummary,
} from '@/kickstart/types'
import { blankTemplate } from '@/kickstart/templates/blank'
import { marketingStudioTemplate } from '@/kickstart/templates/marketing-studio'
import { researchGroupTemplate } from '@/kickstart/templates/research-group'
import { startupTechTemplate } from '@/kickstart/templates/startup-tech'

export const KICKSTART_TEMPLATES: KickstartTemplateDefinition[] = [
  startupTechTemplate,
  marketingStudioTemplate,
  researchGroupTemplate,
  blankTemplate,
]

const templateMap = new Map(
  KICKSTART_TEMPLATES.map((template) => [template.id, template])
)

export function getKickstartTemplateById(
  templateId: string
): KickstartTemplateDefinition | null {
  return templateMap.get(templateId) ?? null
}

export function getKickstartTemplateSummaries(): KickstartTemplateSummary[] {
  return KICKSTART_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    description: template.description,
    recommendedAgentIds: [...template.recommendedAgentIds],
    recommendedModels: { ...template.recommendedModels },
  }))
}
