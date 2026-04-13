import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import type { AgentCapabilities } from '@/lib/agent-capabilities'
import {
  type CommonAgentSummary,
  type CommonWorkspaceConfig,
  getAgentSummaries,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

export type McpAgentSummary = {
  capabilities: AgentCapabilities
  description?: string
  displayName: string
  id: string
  isPrimary: boolean
  mode?: string
  model?: string
  temperature?: number
}

export type McpAgentDetail = McpAgentSummary & {
  prompt?: string
}

export type ListAgentsResult =
  | { ok: true; agents: McpAgentSummary[]; hash: string }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed' }

export type ReadAgentResult =
  | { ok: true; agent: McpAgentDetail; hash: string }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed' }

export async function listAgents(): Promise<ListAgentsResult> {
  const configResult = await loadCommonConfig()
  if (!configResult.ok) {
    return configResult
  }

  return {
    ok: true,
    agents: toSortedAgentSummaries(configResult.config),
    hash: configResult.hash,
  }
}

export async function readAgent(id: string): Promise<ReadAgentResult> {
  const configResult = await loadCommonConfig()
  if (!configResult.ok) {
    return configResult
  }

  const normalizedId = id.trim()
  const agent = getAgentSummaries(configResult.config).find((entry) => entry.id === normalizedId)
  if (!agent) {
    return { ok: false, error: 'not_found' }
  }

  return {
    ok: true,
    agent: {
      ...toMcpAgentSummary(agent),
      prompt: agent.prompt,
    },
    hash: configResult.hash,
  }
}

async function loadCommonConfig(): Promise<
  | { ok: true; config: CommonWorkspaceConfig; hash: string }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed' }
> {
  const result = await readCommonWorkspaceConfig()
  if (!result.ok) {
    return result
  }

  const parsed = parseCommonWorkspaceConfig(result.content)
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  return {
    ok: true,
    config: parsed.config,
    hash: result.hash,
  }
}

function toSortedAgentSummaries(
  config: CommonWorkspaceConfig
): McpAgentSummary[] {
  return getAgentSummaries(config)
    .map(toMcpAgentSummary)
    .sort((left, right) => {
      if (left.isPrimary && !right.isPrimary) return -1
      if (!left.isPrimary && right.isPrimary) return 1
      return left.displayName.localeCompare(right.displayName)
    })
}

function toMcpAgentSummary(
  agent: CommonAgentSummary
): McpAgentSummary {
  return {
    capabilities: agent.capabilities,
    description: agent.description,
    displayName: agent.displayName,
    id: agent.id,
    isPrimary: agent.isPrimary,
    mode: agent.mode,
    model: agent.model,
    temperature: agent.temperature,
  }
}
