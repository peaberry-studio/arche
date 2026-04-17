import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import {
  createDefaultCommonWorkspaceConfig,
  getAgentSummaries,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'
import type { SlackAgentOption } from '@/lib/slack/types'

export async function loadSlackAgentOptions(): Promise<
  | { ok: true; agents: SlackAgentOption[]; primaryAgentId: string | null }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'read_failed' }
> {
  const loaded = await readCommonWorkspaceConfig()
  const config =
    loaded.ok
      ? parseAndValidateConfig(loaded.content)
      : loaded.error === 'not_found'
        ? createDefaultCommonWorkspaceConfig()
        : null

  if (!config) {
    return {
      ok: false,
      error:
        loaded.ok || loaded.error === 'not_found'
          ? 'invalid_config'
          : loaded.error,
    }
  }

  const summaries = getAgentSummaries(config)
  const agents = summaries
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

  return {
    ok: true,
    agents,
    primaryAgentId: summaries.find((agent) => agent.isPrimary)?.id ?? null,
  }
}

function parseAndValidateConfig(content: string) {
  const parsed = parseCommonWorkspaceConfig(content)
  if (!parsed.ok) {
    return null
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return null
  }

  return parsed.config
}
