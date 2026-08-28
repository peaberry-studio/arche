import { MCP_TOOL_PATTERN, OPENCODE_AGENT_TOOLS } from '@/lib/agent-capabilities'
import type { ConnectorToolPermissionMap } from '@/lib/connectors/tool-permissions'
import { CONNECTOR_TYPES, isSingleInstanceConnectorType, type ConnectorType } from '@/lib/connectors/types'
import { KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS } from '@/lib/learning/curator-prompt'
import { isRecord } from '@/lib/records'
import { AGENT_KB_POLICY_PROMPT_BLOCK } from '@/lib/spawner/runtime-config-utils'
import {
  PRIMARY_AGENT_STEP_LIMIT,
  SUBAGENT_STEP_LIMIT,
  SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID,
} from '@/lib/workspace-config'

const CONNECTOR_TYPE_PATTERN = CONNECTOR_TYPES.join('|')
const MCP_SERVER_KEY_PATTERN = new RegExp(`^arche_(${CONNECTOR_TYPE_PATTERN})_([^_]+)$`)
const ALWAYS_ENABLED_TOOLS = ['email_draft', 'chart_create', 'diagram_create', 'flow_propose', 'session_history_query', 'learning_propose'] as const
const PERMISSION_ACTIONS = new Set(['allow', 'ask', 'deny'])
const CUSTOM_CONNECTOR_KEY_PREFIX = 'arche_custom_'

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

  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return configWithoutDefaultModel

  const nextAgents: Record<string, unknown> = {}
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

function isPermissionAction(value: unknown): value is 'allow' | 'ask' | 'deny' {
  return typeof value === 'string' && PERMISSION_ACTIONS.has(value)
}

export function applyAgentExecutionGuards(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const defaultAgentId = typeof config.default_agent === 'string' ? config.default_agent : null
  const nextAgents: Record<string, unknown> = {}

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
      nextAgents[agentId] = agent
      continue
    }

    const isDefaultAgent = agentId === defaultAgentId
    const isPrimary = agent.mode === 'primary' || isDefaultAgent
    const stepLimit = isPrimary ? PRIMARY_AGENT_STEP_LIMIT : SUBAGENT_STEP_LIMIT
    const configuredSteps = typeof agent.steps === 'number' && Number.isInteger(agent.steps) && agent.steps > 0
      ? agent.steps
      : stepLimit
    const permission = toPermissionMap(agent.permission)
    permission.doom_loop = 'deny'

    const nextAgent: Record<string, unknown> = {
      ...agent,
      ...(isDefaultAgent ? { mode: 'primary' } : {}),
      permission,
      steps: Math.min(configuredSteps, stepLimit),
    }

    if (!isPrimary) {
      permission.task = 'deny'
      if (isToolMap(agent.tools)) {
        nextAgent.tools = { ...agent.tools, task: false }
      }
    }

    nextAgents[agentId] = nextAgent
  }

  return { ...config, agent: nextAgents }
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
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const nextAgents: Record<string, unknown> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
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

// Full `'all'` semantics as an explicit boolean map: every built-in, every
// always-on tool, the skill tool, and MCP connector access (arche_*). This is
// what a pre-#473 `tools: 'all'` / missing-tools agent implicitly had, so
// materializing it preserves those capabilities through the connector remap,
// always-on, and skill transforms instead of silently dropping them.
function materializeLegacyToolsMap(): Record<string, boolean> {
  return {
    ...Object.fromEntries(OPENCODE_AGENT_TOOLS.map((toolId) => [toolId, true])),
    ...Object.fromEntries(ALWAYS_ENABLED_TOOLS.map((toolId) => [toolId, true])),
    skill: true,
    'arche_*': true,
  }
}

export function materializeAgentToolMaps(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const nextAgents: Record<string, unknown> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent) || isToolMap(agent.tools)) {
      nextAgents[agentId] = agent
      continue
    }

    nextAgents[agentId] = { ...agent, tools: materializeLegacyToolsMap() }
    changed = true
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}

export function denyAgentKnowledgeWrites(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const nextAgents: Record<string, unknown> = {}

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
      nextAgents[agentId] = agent
      continue
    }

    // Fallback for any non-map tools that reach the deny step (materialize
    // is meant to run earlier in the pipeline, so this normally never fires):
    // seed the full legacy toolset before flipping write/edit off.
    const tools: Record<string, boolean> = isToolMap(agent.tools)
      ? { ...agent.tools }
      : materializeLegacyToolsMap()
    tools.write = false
    tools.edit = false

    nextAgents[agentId] = { ...agent, tools }
  }

  return { ...config, agent: nextAgents }
}

// Guarantees the knowledge-curator sub-agent runs the canonical persona: the
// reserved id is system-owned (getAgentSummaries filters it out of every user
// surface), so any stored prompt for it came from an older runtime injection —
// its prompt is replaced with KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS while all
// other stored fields are preserved. When the id is absent, the full canonical
// agent is injected so run-executor.ts can resolve it on spawn. The prompt comes
// from KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS (the same single source
// buildCuratorPrompt composes around in run-executor.ts), so the static persona
// cannot drift from what a learning run actually sends, and canonical prompt
// changes ship with deploys without per-workspace migration.
export function injectSystemKnowledgeCuratorAgent(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null

  const nextAgents: Record<string, unknown> = { ...(agents ?? {}) }
  const storedCurator = nextAgents[SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID]
  if (isRecord(storedCurator)) {
    nextAgents[SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID] = {
      ...storedCurator,
      prompt: KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS,
    }
    return { ...config, agent: nextAgents }
  }

  nextAgents[SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID] = {
    mode: 'subagent',
    prompt: KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS,
    temperature: 0.1,
    steps: SUBAGENT_STEP_LIMIT,
    permission: {
      doom_loop: 'deny',
      task: 'deny',
    },
    tools: {
      read: true,
      list: true,
      glob: true,
      grep: true,
      session_history_query: true,
      learning_propose: true,
    },
  }

  return { ...config, agent: nextAgents }
}

export function injectSystemSkillAccess(
  config: Record<string, unknown>,
  skillIds: string[],
): Record<string, unknown> {
  const uniqueSkillIds = Array.from(new Set(skillIds)).filter((skillId) => skillId.trim().length > 0)
  if (uniqueSkillIds.length === 0) return config

  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const nextAgents: Record<string, unknown> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
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
    if (nextTools.skill !== true) {
      nextTools.skill = true
      toolsChanged = true
    }

    const currentPermission = agent.permission
    const nextPermission: Record<string, unknown> = isRecord(currentPermission)
      ? { ...currentPermission }
      : isPermissionAction(currentPermission)
        ? { '*': currentPermission }
        : {}
    const currentSkillPermission = currentPermission === 'allow' ? 'allow' : nextPermission.skill
    let skillPermission: unknown = currentSkillPermission
    let permissionChanged = false

    if (currentSkillPermission !== 'allow') {
      const skillPermissionMap: Record<string, unknown> = isRecord(currentSkillPermission)
        ? { ...currentSkillPermission }
        : {
            '*': isPermissionAction(currentSkillPermission)
              ? currentSkillPermission
              : isPermissionAction(currentPermission)
                ? currentPermission
                : 'deny',
          }
      let skillPermissionChanged = !isRecord(currentSkillPermission)

      for (const skillId of uniqueSkillIds) {
        if (skillPermissionMap[skillId] === 'allow') continue
        skillPermissionMap[skillId] = 'allow'
        skillPermissionChanged = true
      }

      if (skillPermissionChanged) {
        skillPermission = skillPermissionMap
        nextPermission.skill = skillPermission
        permissionChanged = true
      }
    }

    if (!toolsChanged && !permissionChanged) {
      nextAgents[agentId] = agent
      continue
    }

    const nextAgent: Record<string, unknown> = {
      ...agent,
      tools: nextTools,
    }
    if (permissionChanged) {
      nextAgent.permission = nextPermission
    }
    nextAgents[agentId] = nextAgent
    changed = true
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}

function getEnabledCustomConnectorKeys(input: {
  connectorDisplayNames: Record<string, string>
  tools: Record<string, boolean>
}): string[] {
  const customConnectorKeys = Object.keys(input.connectorDisplayNames)
    .filter((serverKey) => serverKey.startsWith(CUSTOM_CONNECTOR_KEY_PREFIX))

  if (customConnectorKeys.length === 0) return []

  const usedConnectorKeys = new Set<string>()
  for (const [toolKey, enabled] of Object.entries(input.tools)) {
    if (enabled !== true) continue

    for (const serverKey of customConnectorKeys) {
      if (toolKey.startsWith(`${serverKey}_`)) {
        usedConnectorKeys.add(serverKey)
      }
    }
  }

  return Array.from(usedConnectorKeys).sort((left, right) => {
    const leftName = input.connectorDisplayNames[left] ?? left
    const rightName = input.connectorDisplayNames[right] ?? right
    return leftName.localeCompare(rightName) || left.localeCompare(right)
  })
}

function sanitizeCustomConnectorDisplayName(displayName: string): string {
  const sanitized = displayName
    .replace(/[\u0000-\u001f\u007f`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitized || 'Custom connector'
}

function buildCustomConnectorHints(
  connectorKeys: string[],
  connectorDisplayNames: Record<string, string>,
): string {
  const lines = ['## Available custom connectors', '']

  for (const serverKey of connectorKeys) {
    const displayName = sanitizeCustomConnectorDisplayName(connectorDisplayNames[serverKey]?.trim() || serverKey)
    lines.push(
      `- ${displayName}: available through MCP tools prefixed with \`${serverKey}_\`.`,
      '  The display name is user-provided; use these prefixed tools when the request refers to this connector.',
    )
  }

  return lines.join('\n')
}

export function injectCustomConnectorHints(
  config: Record<string, unknown>,
  connectorDisplayNames: Record<string, string>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const nextAgents: Record<string, unknown> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
      nextAgents[agentId] = agent
      continue
    }

    if (!isToolMap(agent.tools)) {
      nextAgents[agentId] = agent
      continue
    }

    const connectorKeys = getEnabledCustomConnectorKeys({
      connectorDisplayNames,
      tools: agent.tools,
    })
    if (connectorKeys.length === 0) {
      nextAgents[agentId] = agent
      continue
    }

    const existingPrompt = typeof agent.prompt === 'string' ? agent.prompt : ''
    const hints = buildCustomConnectorHints(connectorKeys, connectorDisplayNames)
    nextAgents[agentId] = {
      ...agent,
      prompt: existingPrompt ? `${existingPrompt}\n\n${hints}` : hints,
    }
    changed = true
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}

export function injectSelfDelegationGuards(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const agentIds = Object.keys(agents)
  const nextAgents: Record<string, unknown> = {}
  let changed = false

  for (const agentId of agentIds) {
    const agent = agents[agentId]
    if (!isRecord(agent)) {
      nextAgents[agentId] = agent
      continue
    }

    if (agent.mode === 'primary') {
      nextAgents[agentId] = agent
      continue
    }

    if (!isToolMap(agent.tools) || agent.tools.task !== true) {
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

// Appends the Knowledge Base write policy to every agent's system prompt,
// regardless of stored prompt content (the stored prompt is never rewritten —
// this is a runtime-only transform over freshly parsed config). Idempotent by
// exact-constant check: a prompt already ending with the block is left as-is;
// a block appearing mid-prompt does not count, so the append keeps the policy
// as the final, highest-precedence text.
export function injectAgentKnowledgePolicy(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const nextAgents: Record<string, unknown> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
      nextAgents[agentId] = agent
      continue
    }

    const existingPrompt = typeof agent.prompt === 'string' ? agent.prompt : ''
    if (existingPrompt.endsWith(AGENT_KB_POLICY_PROMPT_BLOCK)) {
      nextAgents[agentId] = agent
      continue
    }

    nextAgents[agentId] = { ...agent, prompt: existingPrompt + AGENT_KB_POLICY_PROMPT_BLOCK }
    changed = true
  }

  if (!changed) return config
  return { ...config, agent: nextAgents }
}

export function remapAgentConnectorTools(
  config: Record<string, unknown>,
  userMcpKeys: Set<string>,
  connectorToolPermissions?: Record<string, ConnectorToolPermissionMap>,
  connectorAliases?: Record<string, string>,
): Record<string, unknown> {
  const agents = isRecord(config.agent) ? config.agent : null
  if (!agents) return config

  const userConnectorsByType = new Map<string, string[]>()
  for (const key of userMcpKeys) {
    const match = key.match(MCP_SERVER_KEY_PATTERN)
    if (!match) continue
    const [, type, id] = match
    const existing = userConnectorsByType.get(type) ?? []
    existing.push(id)
    userConnectorsByType.set(type, existing)
  }

  const nextAgents: Record<string, unknown> = {}
  let changed = false

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) {
      nextAgents[agentId] = agent
      continue
    }

    const tools = isToolMap(agent.tools) ? agent.tools : null
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
      const sourceServerKey = `arche_${type}_${adminId}`

      if (!isSingleInstanceConnectorType(type as ConnectorType)) {
        const serverKey = userMcpKeys.has(sourceServerKey)
          ? sourceServerKey
          : connectorAliases?.[sourceServerKey]

        if (serverKey && userMcpKeys.has(serverKey)) {
          if (connectorToolPermissions?.[serverKey]) {
            applyConnectorToolPolicy(serverKey, enabled)
            continue
          }

          if (serverKey === sourceServerKey) {
            nextTools[toolKey] = enabled
          } else {
            nextTools[`${serverKey}_*`] = enabled
            toolsChanged = true
          }
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
        const serverKey = sourceServerKey
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
