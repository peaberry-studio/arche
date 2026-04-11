import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import {
  getAgentSummaries,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

export type AutopilotAgentOption = {
  id: string
  displayName: string
  isPrimary: boolean
}

export async function listAutopilotAgentOptions(): Promise<
  | { ok: true; agents: AutopilotAgentOption[] }
  | { ok: false; error: string }
> {
  const result = await readCommonWorkspaceConfig()
  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  const parsed = parseCommonWorkspaceConfig(result.content)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return { ok: false, error: validation.error ?? 'invalid_config' }
  }

  const agents = getAgentSummaries(parsed.config)
    .map((agent) => ({
      id: agent.id,
      displayName: agent.displayName,
      isPrimary: agent.isPrimary,
    }))
    .sort((left, right) => {
      if (left.isPrimary && !right.isPrimary) return -1
      if (!left.isPrimary && right.isPrimary) return 1
      return left.displayName.localeCompare(right.displayName)
    })

  return { ok: true, agents }
}
