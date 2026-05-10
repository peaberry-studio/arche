import { MCP_TOOL_PATTERN } from '@/lib/agent-capabilities'
import type { ConnectorToolPermissionMap } from '@/lib/connectors/tool-permissions'
import { CONNECTOR_TYPES, isSingleInstanceConnectorType, type ConnectorType } from '@/lib/connectors/types'
import { isRecord } from '@/lib/records'

const CONNECTOR_TYPE_PATTERN = CONNECTOR_TYPES.join('|')
const MCP_SERVER_KEY_PATTERN = new RegExp(`^arche_(${CONNECTOR_TYPE_PATTERN})_([a-z0-9]+)$`)
const ALWAYS_ENABLED_TOOLS = ['email_draft', 'chart_create', 'diagram_create'] as const

function isToolMap(value: unknown): value is Record<string, boolean> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function applyDefaultAgentModel(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const defaultModel = typeof config.default_model === 'string' && config.default_model.trim()
    ? config.default_model.trim()
    : undefined
  if (!defaultModel) return config

  const configWithoutDefaultModel = { ...config }
  delete configWithoutDefaultModel.default_model

  const agents = config.agent as Record<string, Record<string, unknown>> | undefined
  if (!agents || typeof agents !== 'object') return configWithoutDefaultModel

  const nextAgents: Record<string, Record<string, unknown>> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
      nextAgents[agentId] = agent
      continue
    }

    if (typeof agent.model === 'string' && agent.model.trim()) {
      nextAgents[agentId] = agent
      continue
    }

    nextAgents[agentId] = { ...agent, model: defaultModel }
    changed = true
  }

  if (!changed) return configWithoutDefaultModel
  return { ...configWithoutDefaultModel, agent: nextAgents }
}

function buildExactConnectorToolName(serverKey: string, toolName: string): string {
  return `${serverKey}_${toolName}`
}

function toPermissionMap(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return { '*': value }
  }

  return isRecord(value) ? { ...value } : {}
}

function expandConnectorToolPolicy(input: {
  serverKey: string
  enabled: boolean
  permissions: ConnectorToolPermissionMap
  currentPermission: unknown
}): {
  tools: Record<string, boolean>
  permission: Record<string, unknown>
} {
  const tools: Record<string, boolean> = {}
  const permission = toPermissionMap(input.currentPermission)

  for (const [toolName, action] of Object.entries(input.permissions)) {
    const exactToolName = buildExactConnectorToolName(input.serverKey, toolName)
    tools[exactToolName] = input.enabled
    permission[exactToolName] = action
  }

  return { tools, permission }
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
  connectorToolPermissions?: Record<string, ConnectorToolPermissionMap>,
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
    let nextPermission: Record<string, unknown> | undefined
    let toolsChanged = false
    let permissionChanged = false

    const applyConnectorToolPolicy = (serverKey: string, enabled: boolean) => {
      const toolPermissions = connectorToolPermissions?.[serverKey]
      if (!toolPermissions) {
        nextTools[`${serverKey}_*`] = enabled
        return
      }

      toolsChanged = true
      const expanded = expandConnectorToolPolicy({
        serverKey,
        enabled,
        permissions: toolPermissions,
        currentPermission: nextPermission ?? agent.permission,
      })
      Object.assign(nextTools, expanded.tools)
      nextPermission = expanded.permission

      permissionChanged = true
    }

    for (const [toolKey, enabled] of Object.entries(tools)) {
      const match = toolKey.match(MCP_TOOL_PATTERN)
      if (!match) {
        nextTools[toolKey] = enabled
        continue
      }

      const [, type, adminId] = match

      if (!isSingleInstanceConnectorType(type as ConnectorType)) {
        const serverKey = `arche_${type}_${adminId}`
        if (userMcpKeys.has(serverKey)) {
          if (connectorToolPermissions?.[serverKey]) {
            applyConnectorToolPolicy(serverKey, enabled)
            continue
          }

          nextTools[toolKey] = enabled
          continue
        }

        toolsChanged = true
        continue
      }

      const userIds = userConnectorsByType.get(type)

      if (!userIds || userIds.length === 0) {
        toolsChanged = true
        continue
      }

      if (userIds.length === 1 && userIds[0] === adminId) {
        const serverKey = `arche_${type}_${adminId}`
        if (connectorToolPermissions?.[serverKey]) {
          applyConnectorToolPolicy(serverKey, enabled)
        } else {
          nextTools[toolKey] = enabled
        }
        continue
      }

      toolsChanged = true
      for (const userId of userIds) {
        applyConnectorToolPolicy(`arche_${type}_${userId}`, enabled)
      }
    }

    if (toolsChanged || permissionChanged) {
      nextAgents[agentId] = {
        ...agent,
        tools: nextTools,
        ...(nextPermission ? { permission: nextPermission } : {}),
      }
      changed = true
    } else {
      nextAgents[agentId] = agent
    }
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}
