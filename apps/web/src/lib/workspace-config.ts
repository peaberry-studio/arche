import {
  buildAgentPermissionConfigFromCapabilities,
  extractAgentCapabilitiesFromTools,
  type AgentCapabilities,
} from '@/lib/agent-capabilities'

export type CommonAgentConfig = {
  description?: string
  display_name?: string
  mode?: 'primary' | 'subagent' | 'all'
  model?: string
  permission?: Record<string, unknown>
  temperature?: number
  prompt?: string
  tools?: Record<string, boolean>
  [key: string]: unknown
}

export type CommonWorkspaceConfig = {
  $schema?: string
  default_agent?: string
  agent?: Record<string, CommonAgentConfig>
  [key: string]: unknown
}

export function createDefaultCommonWorkspaceConfig(): CommonWorkspaceConfig {
  return {
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'assistant',
    agent: {
      assistant: {
        display_name: 'Assistant',
        description: 'General-purpose assistant',
        mode: 'primary',
        model: 'openai/gpt-5.2',
        temperature: 0.2,
        prompt: 'You are a helpful assistant.',
        tools: {
          write: true,
          edit: true,
          bash: true
        }
      }
    }
  }
}

export type CommonAgentSummary = {
  id: string
  name: string
  displayName: string
  description?: string
  model?: string
  temperature?: number
  prompt?: string
  mode?: string
  isPrimary: boolean
  capabilities: AgentCapabilities
}

export type CommonWorkspaceConfigResult =
  | { ok: true; config: CommonWorkspaceConfig }
  | { ok: false; error: string }

export function parseCommonWorkspaceConfig(raw: string): CommonWorkspaceConfigResult {
  if (!raw.trim()) {
    return { ok: false, error: 'empty_config' }
  }

  try {
    const parsed = JSON.parse(raw) as CommonWorkspaceConfig
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'invalid_config' }
    }
    return { ok: true, config: parsed }
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
}

export function validateCommonWorkspaceConfig(config: CommonWorkspaceConfig): { ok: boolean; error?: string } {
  if (!config || typeof config !== 'object') {
    return { ok: false, error: 'invalid_config' }
  }

  const agents = config.agent
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    return { ok: false, error: 'missing_agents' }
  }

  const agentIds = Object.keys(agents)
  if (agentIds.length === 0) {
    return { ok: false, error: 'no_agents' }
  }

  const defaultAgent = config.default_agent
  if (!defaultAgent || typeof defaultAgent !== 'string') {
    return { ok: false, error: 'missing_default_agent' }
  }
  if (!agents[defaultAgent]) {
    return { ok: false, error: 'default_agent_not_found' }
  }

  const primaryAgents = agentIds.filter((id) => agents[id]?.mode === 'primary')
  if (primaryAgents.length > 1) {
    return { ok: false, error: 'multiple_primary_agents' }
  }
  if (primaryAgents.length === 1 && primaryAgents[0] !== defaultAgent) {
    return { ok: false, error: 'default_agent_mismatch' }
  }

  return { ok: true }
}

export function ensurePrimaryAgent(config: CommonWorkspaceConfig, agentId: string): CommonWorkspaceConfig {
  const agents = config.agent ?? {}
  const nextAgents: Record<string, CommonAgentConfig> = {}

  Object.entries(agents).forEach(([id, agent]) => {
    if (id === agentId) {
      nextAgents[id] = { ...agent, mode: 'primary' }
      return
    }
    if (agent?.mode === 'primary') {
      nextAgents[id] = { ...agent, mode: 'subagent' }
      return
    }
    nextAgents[id] = agent
  })

  return {
    ...config,
    default_agent: agentId,
    agent: nextAgents
  }
}

export function getAgentSummaries(config: CommonWorkspaceConfig): CommonAgentSummary[] {
  const agents = config.agent ?? {}
  const defaultAgent = config.default_agent

  return Object.entries(agents).map(([id, agent]) => ({
    id,
    name: id,
    displayName: typeof agent?.display_name === 'string' && agent.display_name.trim()
      ? agent.display_name.trim()
      : id,
    description: typeof agent?.description === 'string' ? agent.description : undefined,
    model: typeof agent?.model === 'string' ? agent.model : undefined,
    temperature: typeof agent?.temperature === 'number' ? agent.temperature : undefined,
    prompt: typeof agent?.prompt === 'string' ? agent.prompt : undefined,
    mode: typeof agent?.mode === 'string' ? agent.mode : undefined,
    isPrimary: defaultAgent === id || agent?.mode === 'primary',
    capabilities: extractAgentCapabilitiesFromTools(agent?.tools, agent?.permission)
  }))
}

function isToolMap(value: unknown): value is Record<string, boolean> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function setAgentSkillIds(agent: CommonAgentConfig, skillIds: string[]): CommonAgentConfig {
  const capabilities = extractAgentCapabilitiesFromTools(agent.tools, agent.permission)
  const nextSkillIds = Array.from(new Set(skillIds)).sort((left, right) => left.localeCompare(right))
  const nextTools = isToolMap(agent.tools) ? { ...agent.tools } : {}

  if (nextSkillIds.length > 0) {
    nextTools.skill = true
  } else {
    delete nextTools.skill
  }

  const nextPermission = buildAgentPermissionConfigFromCapabilities(
    { ...capabilities, skillIds: nextSkillIds },
    agent.permission,
  )

  const nextAgent: CommonAgentConfig = {
    ...agent,
    tools: Object.keys(nextTools).length > 0 ? nextTools : undefined,
  }

  if (nextPermission) {
    nextAgent.permission = nextPermission
  } else {
    delete nextAgent.permission
  }

  return nextAgent
}

export function getAssignedAgentIdsForSkill(config: CommonWorkspaceConfig, skillId: string): string[] {
  const agents = config.agent ?? {}

  return Object.entries(agents)
    .filter(([, agent]) => extractAgentCapabilitiesFromTools(agent?.tools, agent?.permission).skillIds.includes(skillId))
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right))
}

export function setSkillAssignments(
  config: CommonWorkspaceConfig,
  skillId: string,
  assignedAgentIds: string[],
): CommonWorkspaceConfig {
  const targetAgentIds = new Set(assignedAgentIds)
  const agents = config.agent ?? {}

  return {
    ...config,
    agent: Object.fromEntries(
      Object.entries(agents).map(([id, agent]) => {
        const capabilities = extractAgentCapabilitiesFromTools(agent?.tools, agent?.permission)
        const nextSkillIds = targetAgentIds.has(id)
          ? [...capabilities.skillIds, skillId]
          : capabilities.skillIds.filter((entry) => entry !== skillId)

        return [id, setAgentSkillIds(agent, nextSkillIds)]
      })
    ),
  }
}

export function generateAgentId(displayName: string, existingIds: string[]): string {
  const normalized = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const base = normalized || 'agent'
  const existing = new Set(existingIds)
  let candidate = base
  let counter = 2

  while (existing.has(candidate)) {
    candidate = `${base}-${counter}`
    counter += 1
  }

  return candidate
}
