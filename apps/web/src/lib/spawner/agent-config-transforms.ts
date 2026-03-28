import { MCP_TOOL_PATTERN } from '@/lib/agent-capabilities'

const MCP_SERVER_KEY_PATTERN = /^arche_(linear|notion|custom)_([a-z0-9]+)$/
const ALWAYS_ENABLED_TOOLS = ['email_draft'] as const

function isToolMap(value: unknown): value is Record<string, boolean> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function injectAlwaysOnAgentTools(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = config.agent as Record<string, Record<string, unknown>> | undefined
  if (!agents || typeof agents !== 'object') return config

  const nextAgents: Record<string, Record<string, unknown>> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!agent || typeof agent !== 'object') {
      nextAgents[agentId] = agent
      continue
    }

    if (!isToolMap(agent.tools)) {
      nextAgents[agentId] = agent
      continue
    }

    const currentTools = agent.tools
    const nextTools: Record<string, boolean> = { ...currentTools }
    let toolsChanged = false

    for (const toolName of ALWAYS_ENABLED_TOOLS) {
      if (nextTools[toolName] === true) continue
      nextTools[toolName] = true
      toolsChanged = true
    }

    if (toolsChanged) {
      nextAgents[agentId] = { ...agent, tools: nextTools }
      changed = true
      continue
    }

    nextAgents[agentId] = agent
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}

export function injectSelfDelegationGuards(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = config.agent as Record<string, Record<string, unknown>> | undefined
  if (!agents || typeof agents !== 'object') return config

  const agentIds = Object.keys(agents)
  const nextAgents: Record<string, Record<string, unknown>> = {}
  let changed = false

  for (const agentId of agentIds) {
    const agent = agents[agentId]
    if (!agent || typeof agent !== 'object') {
      nextAgents[agentId] = agent
      continue
    }

    if (agent.mode === 'primary') {
      nextAgents[agentId] = agent
      continue
    }

    const tools = agent.tools as Record<string, boolean> | undefined
    if (!tools || tools.task !== true) {
      nextAgents[agentId] = agent
      continue
    }

    const otherAgentIds = agentIds.filter((id) => id !== agentId)

    const guard = [
      '',
      '## Delegation constraint',
      `CRITICAL: You MUST NEVER use the task tool to invoke yourself ("${agentId}"). ` +
        `Self-delegation creates an infinite loop. ` +
        `You may delegate to: ${otherAgentIds.join(', ')}.`,
    ].join('\n')

    const existingPrompt = typeof agent.prompt === 'string' ? agent.prompt : ''
    nextAgents[agentId] = { ...agent, prompt: existingPrompt + guard }
    changed = true
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}

export function remapAgentConnectorTools(
  config: Record<string, unknown>,
  userMcpKeys: Set<string>,
): Record<string, unknown> {
  const agents = config.agent as Record<string, Record<string, unknown>> | undefined
  if (!agents || typeof agents !== 'object') return config

  const userConnectorsByType = new Map<string, string[]>()
  for (const key of userMcpKeys) {
    const match = key.match(MCP_SERVER_KEY_PATTERN)
    if (!match) continue
    const [, type, id] = match
    const existing = userConnectorsByType.get(type) ?? []
    existing.push(id)
    userConnectorsByType.set(type, existing)
  }

  const nextAgents: Record<string, Record<string, unknown>> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!agent || typeof agent !== 'object') {
      nextAgents[agentId] = agent
      continue
    }

    const tools = agent.tools as Record<string, boolean> | undefined
    if (!tools) {
      nextAgents[agentId] = agent
      continue
    }

    const nextTools: Record<string, boolean> = {}
    let toolsChanged = false

    for (const [toolKey, enabled] of Object.entries(tools)) {
      const match = toolKey.match(MCP_TOOL_PATTERN)
      if (!match) {
        nextTools[toolKey] = enabled
        continue
      }

      const [, type, adminId] = match
      const userIds = userConnectorsByType.get(type)

      if (!userIds || userIds.length === 0) {
        toolsChanged = true
        continue
      }

      if (userIds.length === 1 && userIds[0] === adminId) {
        nextTools[toolKey] = enabled
        continue
      }

      toolsChanged = true
      for (const userId of userIds) {
        nextTools[`arche_${type}_${userId}_*`] = enabled
      }
    }

    if (toolsChanged) {
      nextAgents[agentId] = { ...agent, tools: nextTools }
      changed = true
    } else {
      nextAgents[agentId] = agent
    }
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}
