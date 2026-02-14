const DEFAULT_REQUIRED_AGENT_IDS = ['assistant'] as const

const REQUIRED_AGENT_IDS_BY_TEMPLATE: Record<string, readonly string[]> = {
  blank: ['assistant', 'knowledge-curator'],
}

export function getRequiredAgentIdsForTemplate(templateId: string): readonly string[] {
  return REQUIRED_AGENT_IDS_BY_TEMPLATE[templateId] ?? DEFAULT_REQUIRED_AGENT_IDS
}
