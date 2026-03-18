import { MCP_TOOL_PATTERN } from '@/lib/agent-capabilities'

const MCP_SERVER_KEY_PATTERN = /^arche_(linear|notion|custom)_([a-z0-9]+)$/

/**
 * Inject a self-delegation guard into each sub-agent's prompt that has the
 * `task` tool enabled. This prevents infinite loops where a sub-agent invokes
 * itself via the task tool instead of calling MCP tools directly.
 *
 * Primary agents are left untouched (they are the orchestrator).
 * Agents without `task: true` are left untouched (they cannot delegate).
 */
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

    // Skip primary agents — they are the orchestrator
    if (agent.mode === 'primary') {
      nextAgents[agentId] = agent
      continue
    }

    // Skip agents without the task tool
    const tools = agent.tools as Record<string, boolean> | undefined
    if (!tools || tools.task !== true) {
      nextAgents[agentId] = agent
      continue
    }

    // Build list of agents this one CAN delegate to (all others with task capability)
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

/**
 * Remap MCP connector tool references in agent configs so they point to the
 * current user's connector IDs instead of the admin's who created the config.
 *
 * - Tools matching `arche_<type>_<adminId>_*` are replaced with the user's
 *   connector IDs for the same type.
 * - If the user has no connector for that type, the reference is removed.
 * - If the user has multiple connectors of the same type, all are added.
 * - Non-MCP tools (`task`, `bash`, etc.) and `arche_*: false` pass through unchanged.
 */
export function remapAgentConnectorTools(
  config: Record<string, unknown>,
  userMcpKeys: Set<string>,
): Record<string, unknown> {
  const agents = config.agent as Record<string, Record<string, unknown>> | undefined
  if (!agents || typeof agents !== 'object') return config

  // Build a map: type -> connectorId[] from the user's MCP server keys
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
        // Non-MCP tool or arche_*: false — pass through
        nextTools[toolKey] = enabled
        continue
      }

      const [, type, adminId] = match
      const userIds = userConnectorsByType.get(type)

      if (!userIds || userIds.length === 0) {
        // User has no connector of this type — drop the reference
        toolsChanged = true
        continue
      }

      // Check if the admin ID is already the user's ID (no-op case)
      if (userIds.length === 1 && userIds[0] === adminId) {
        nextTools[toolKey] = enabled
        continue
      }

      // Replace with user's connector(s)
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
