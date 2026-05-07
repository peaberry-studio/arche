import { NextResponse } from 'next/server'

import {
  buildAgentPermissionConfigFromCapabilities,
  buildAgentToolsConfigFromCapabilities,
  type AgentCapabilities,
  type ConnectorCapabilityRecord,
  validateAgentCapabilityConnectorIds,
  validateAgentCapabilitySkillIds,
  validateAgentCapabilityTools,
} from '@/lib/agent-capabilities'
import { loadAvailableConnectorCapabilities } from '@/lib/agent-connector-capabilities'
import { auditEvent } from '@/lib/auth'
import { readCommonWorkspaceConfig, writeCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import { withAuth } from '@/lib/runtime/with-auth'
import { listSkills } from '@/lib/skills/skill-store'
import {
  type CommonAgentConfig,
  type CommonWorkspaceConfig,
  createDefaultCommonWorkspaceConfig,
  ensurePrimaryAgent,
  generateAgentId,
  getAgentSummaries,
  getDefaultModel,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

export type AgentListItem = {
  id: string
  displayName: string
  description?: string
  defaultModel?: string
  model?: string
  resolvedModel?: string
  temperature?: number
  usesDefaultModel: boolean
  isPrimary: boolean
  capabilities: AgentCapabilities
}

type AgentsListResponse = {
  agents: AgentListItem[]
  defaultModel?: string
  hash?: string
}

type CreateAgentRequest = {
  id?: string
  displayName?: string
  name?: string
  description?: string
  model?: string
  temperature?: number
  prompt?: string
  isPrimary?: boolean
  expectedHash?: string
  capabilities?: {
    skillIds?: unknown
    tools?: unknown
    mcpConnectorIds?: unknown
  }
}

const RESERVED_AGENT_IDS = new Set(['connectors', 'default-model', 'models'])

async function loadCommonConfig() {
  const result = await readCommonWorkspaceConfig()
  if (!result.ok) {
    return { ok: false as const, error: result.error }
  }

  const parsed = parseCommonWorkspaceConfig(result.content)
  if (!parsed.ok) {
    return { ok: false as const, error: parsed.error }
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return { ok: false as const, error: validation.error ?? 'invalid_config' }
  }

  return {
    ok: true as const,
    config: parsed.config,
    hash: result.hash,
  }
}

function parseCapabilities(
  value: unknown,
  availableConnectors: ConnectorCapabilityRecord[],
  availableSkillIds: Set<string>,
): { ok: true; capabilities: AgentCapabilities } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid_capabilities' }
  }

  const capabilities = value as {
    skillIds?: unknown
    tools?: unknown
    mcpConnectorIds?: unknown
  }

  const toolsResult = validateAgentCapabilityTools(capabilities.tools)
  if (!toolsResult.ok) {
    return { ok: false, error: toolsResult.error }
  }

  const connectorResult = validateAgentCapabilityConnectorIds(capabilities.mcpConnectorIds)
  if (!connectorResult.ok) {
    return { ok: false, error: connectorResult.error }
  }

  const availableConnectorIds = new Set(availableConnectors.map((connector) => connector.id))
  const unknownConnectorId = connectorResult.connectorIds.find(
    (connectorId) => !availableConnectorIds.has(connectorId)
  )
  if (unknownConnectorId) {
    return { ok: false, error: 'unknown_mcp_connector' }
  }

  const skillResult = validateAgentCapabilitySkillIds(capabilities.skillIds)
  if (!skillResult.ok) {
    return { ok: false, error: skillResult.error }
  }

  const unknownSkillId = skillResult.skillIds.find((skillId) => !availableSkillIds.has(skillId))
  if (unknownSkillId) {
    return { ok: false, error: 'unknown_skill' }
  }

  return {
    ok: true,
    capabilities: {
      skillIds: skillResult.skillIds,
      tools: toolsResult.tools,
      mcpConnectorIds: connectorResult.connectorIds,
    },
  }
}

export const GET = withAuth<AgentsListResponse | { error: string }>(
  { csrf: false },
  async (_request, _context) => {
    const configResult = await loadCommonConfig()
    if (!configResult.ok) {
      if (configResult.error === 'not_found') {
        return NextResponse.json({ agents: [] })
      }
      const status = configResult.error === 'kb_unavailable' ? 503 : 500
      return NextResponse.json({ error: configResult.error }, { status })
    }

    const defaultModel = getDefaultModel(configResult.config)
    const agents = getAgentSummaries(configResult.config)
      .map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        description: agent.description,
        defaultModel,
        model: agent.model,
        resolvedModel: agent.model ?? defaultModel,
        temperature: agent.temperature,
        usesDefaultModel: !agent.model,
        isPrimary: agent.isPrimary,
        capabilities: agent.capabilities,
      }))
      .sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1
        if (!a.isPrimary && b.isPrimary) return 1
        return a.displayName.localeCompare(b.displayName)
      })

    return NextResponse.json({ agents, defaultModel, hash: configResult.hash })
  }
)

export const POST = withAuth<{ agent: AgentListItem; hash?: string } | { error: string; message?: string }>(
  { csrf: true },
  async (request, { user, slug }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: CreateAgentRequest
    try {
      body = await request.json()
    } catch (err) {
      if (err instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw err
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const displayNameRaw =
      typeof body.displayName === 'string'
        ? body.displayName.trim()
        : typeof body.name === 'string'
          ? body.name.trim()
          : ''
    if (!displayNameRaw) {
      return NextResponse.json({ error: 'missing_display_name' }, { status: 400 })
    }

    const loadedConfig = await loadCommonConfig()
    const configResult = loadedConfig.ok
      ? loadedConfig
      : loadedConfig.error === 'not_found'
        ? {
            ok: true as const,
            config: createDefaultCommonWorkspaceConfig(),
            hash: undefined,
          }
        : loadedConfig

    if (!configResult.ok) {
      const status = configResult.error === 'kb_unavailable' ? 503 : 500
      return NextResponse.json({ error: configResult.error }, { status })
    }

    const existingIds = Object.keys(configResult.config.agent ?? {})
    const explicitId = typeof body.id === 'string' ? body.id.trim() : ''
    const id = explicitId || generateAgentId(displayNameRaw, existingIds)

    if (id.includes('/') || /\s/.test(id)) {
      return NextResponse.json(
        { error: 'invalid_id', message: 'Agent id must not include spaces or slashes.' },
        { status: 400 }
      )
    }
    if (RESERVED_AGENT_IDS.has(id)) {
      return NextResponse.json({ error: 'invalid_id', message: 'Agent id is reserved.' }, { status: 400 })
    }
    if (configResult.config.agent?.[id]) {
      return NextResponse.json({ error: 'agent_exists' }, { status: 409 })
    }

    const prompt = typeof body.prompt === 'string' ? body.prompt : ''
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : undefined
    const temperature =
      typeof body.temperature === 'number' && Number.isFinite(body.temperature)
        ? body.temperature
        : undefined

    const availableConnectors = await loadAvailableConnectorCapabilities()
    const skillsResult = await listSkills()
    if (!skillsResult.ok) {
      const status = skillsResult.error === 'kb_unavailable' ? 503 : 500
      return NextResponse.json({ error: skillsResult.error }, { status })
    }

    const capabilitiesResult = parseCapabilities(
      body.capabilities,
      availableConnectors,
      new Set(skillsResult.data.map((skill) => skill.name))
    )
    if (!capabilitiesResult.ok) {
      return NextResponse.json({ error: capabilitiesResult.error }, { status: 400 })
    }

    const newAgent: CommonAgentConfig = {
      display_name: displayNameRaw,
      description,
      mode: 'subagent',
      model,
      temperature,
      prompt,
      permission: buildAgentPermissionConfigFromCapabilities(capabilitiesResult.capabilities, undefined),
      tools: buildAgentToolsConfigFromCapabilities(capabilitiesResult.capabilities, availableConnectors),
    }

    const nextConfig: CommonWorkspaceConfig = {
      ...configResult.config,
      agent: {
        ...configResult.config.agent,
        [id]: newAgent,
      },
    }

    const withPrimary = body.isPrimary ? ensurePrimaryAgent(nextConfig, id) : nextConfig
    const validation = validateCommonWorkspaceConfig(withPrimary)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error ?? 'invalid_config' }, { status: 400 })
    }

    const content = JSON.stringify(withPrimary, null, 2)
    const expectedHash =
      typeof body.expectedHash === 'string' && body.expectedHash ? body.expectedHash : configResult.hash

    const writeResult = await writeCommonWorkspaceConfig(content, expectedHash)
    if (!writeResult.ok) {
      const status = writeResult.error === 'conflict' ? 409 : 500
      return NextResponse.json({ error: writeResult.error ?? 'write_failed' }, { status })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'agent.created',
      metadata: { slug, agentId: id },
    })

    const createdAgent = getAgentSummaries(withPrimary).find((agent) => agent.id === id)
    if (!createdAgent) {
      return NextResponse.json({ error: 'agent_create_failed' }, { status: 500 })
    }

    const defaultModel = getDefaultModel(withPrimary)

    return NextResponse.json(
      {
        agent: {
          id: createdAgent.id,
          displayName: createdAgent.displayName,
          description: createdAgent.description,
          defaultModel,
          model: createdAgent.model,
          resolvedModel: createdAgent.model ?? defaultModel,
          temperature: createdAgent.temperature,
          usesDefaultModel: !createdAgent.model,
          isPrimary: createdAgent.isPrimary,
          capabilities: createdAgent.capabilities,
        },
        hash: writeResult.hash,
      },
      { status: 201 }
    )
  }
)
