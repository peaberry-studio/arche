import { NextRequest, NextResponse } from 'next/server'

import {
  buildAgentToolsConfigFromCapabilities,
  type AgentCapabilities,
  validateAgentCapabilityConnectorIds,
  validateAgentCapabilityTools,
} from '@/lib/agent-capabilities'
import { auditEvent, getAuthenticatedUser } from '@/lib/auth'
import { readCommonWorkspaceConfig, writeCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import { validateSameOrigin } from '@/lib/csrf'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import { prisma } from '@/lib/prisma'
import {
  type CommonWorkspaceConfig,
  ensurePrimaryAgent,
  getAgentSummaries,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

type AgentDetailResponse = {
  agent: {
    id: string
    displayName: string
    description?: string
    model?: string
    temperature?: number
    prompt?: string
    isPrimary: boolean
    capabilities: AgentCapabilities
  }
  hash?: string
}

type UpdateAgentRequest = {
  displayName?: string | null
  description?: string | null
  model?: string | null
  temperature?: number | null
  prompt?: string | null
  isPrimary?: boolean
  expectedHash?: string
  capabilities?: {
    tools?: unknown
    mcpConnectorIds?: unknown
  }
}

type EnabledConnector = {
  id: string
  type: ConnectorType
  enabled: boolean
}

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

async function loadEnabledConnectorsForSlug(slug: string): Promise<EnabledConnector[]> {
  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!user) return []

  const connectors = await prisma.connector.findMany({
    where: { userId: user.id, enabled: true },
    select: { id: true, type: true, enabled: true },
  })

  const enabled: EnabledConnector[] = []
  for (const connector of connectors) {
    if (!validateConnectorType(connector.type)) continue
    enabled.push({
      id: connector.id,
      type: connector.type,
      enabled: connector.enabled,
    })
  }

  return enabled
}

function parseCapabilities(
  value: unknown,
  enabledConnectors: EnabledConnector[]
): { ok: true; capabilities: AgentCapabilities } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid_capabilities' }
  }

  const capabilities = value as {
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

  const enabledConnectorIds = new Set(enabledConnectors.map((connector) => connector.id))
  const unknownConnectorId = connectorResult.connectorIds.find(
    (connectorId) => !enabledConnectorIds.has(connectorId)
  )
  if (unknownConnectorId) {
    return { ok: false, error: 'unknown_mcp_connector' }
  }

  return {
    ok: true,
    capabilities: {
      tools: toolsResult.tools,
      mcpConnectorIds: connectorResult.connectorIds,
    },
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; name: string }> }
): Promise<NextResponse<AgentDetailResponse | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug, name } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const configResult = await loadCommonConfig()
  if (!configResult.ok) {
    const status =
      configResult.error === 'not_found' ? 404 : configResult.error === 'kb_unavailable' ? 503 : 500
    return NextResponse.json({ error: configResult.error }, { status })
  }

  const agent = getAgentSummaries(configResult.config).find((entry) => entry.id === name)
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({
    agent: {
      id: agent.id,
      displayName: agent.displayName,
      description: agent.description,
      model: agent.model,
      temperature: agent.temperature,
      prompt: agent.prompt,
      isPrimary: agent.isPrimary,
      capabilities: agent.capabilities,
    },
    hash: configResult.hash,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; name: string }> }
): Promise<NextResponse<AgentDetailResponse | { error: string; message?: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug, name } = await params

  let body: UpdateAgentRequest
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

  const configResult = await loadCommonConfig()
  if (!configResult.ok) {
    const status =
      configResult.error === 'not_found' ? 404 : configResult.error === 'kb_unavailable' ? 503 : 500
    return NextResponse.json({ error: configResult.error }, { status })
  }

  const existing = configResult.config.agent?.[name]
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const updated = { ...existing }

  if ('displayName' in body) {
    if (body.displayName === null || body.displayName === '') {
      delete updated.display_name
    } else if (typeof body.displayName === 'string') {
      updated.display_name = body.displayName.trim()
    } else {
      return NextResponse.json({ error: 'invalid_display_name' }, { status: 400 })
    }
  }

  if ('description' in body) {
    if (body.description === null || body.description === '') {
      delete updated.description
    } else if (typeof body.description === 'string') {
      updated.description = body.description.trim()
    } else {
      return NextResponse.json({ error: 'invalid_description' }, { status: 400 })
    }
  }

  if ('model' in body) {
    if (body.model === null || body.model === '') {
      delete updated.model
    } else if (typeof body.model === 'string') {
      updated.model = body.model.trim()
    } else {
      return NextResponse.json({ error: 'invalid_model' }, { status: 400 })
    }
  }

  if ('temperature' in body) {
    if (body.temperature === null) {
      delete updated.temperature
    } else if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) {
      updated.temperature = body.temperature
    } else {
      return NextResponse.json({ error: 'invalid_temperature' }, { status: 400 })
    }
  }

  if ('prompt' in body) {
    if (body.prompt === null) {
      delete updated.prompt
    } else if (typeof body.prompt === 'string') {
      updated.prompt = body.prompt
    } else {
      return NextResponse.json({ error: 'invalid_prompt' }, { status: 400 })
    }
  }

  if ('capabilities' in body) {
    const enabledConnectors = await loadEnabledConnectorsForSlug(slug)
    const capabilitiesResult = parseCapabilities(body.capabilities, enabledConnectors)
    if (!capabilitiesResult.ok) {
      return NextResponse.json({ error: capabilitiesResult.error }, { status: 400 })
    }

    updated.tools = buildAgentToolsConfigFromCapabilities(
      capabilitiesResult.capabilities,
      enabledConnectors
    )
  }

  let nextConfig: CommonWorkspaceConfig = {
    ...configResult.config,
    agent: {
      ...configResult.config.agent,
      [name]: updated,
    },
  }

  if (body.isPrimary === true) {
    nextConfig = ensurePrimaryAgent(nextConfig, name)
  } else if (body.isPrimary === false && configResult.config.default_agent === name) {
    return NextResponse.json({ error: 'primary_required' }, { status: 409 })
  }

  const validation = validateCommonWorkspaceConfig(nextConfig)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error ?? 'invalid_config' }, { status: 400 })
  }

  const content = JSON.stringify(nextConfig, null, 2)
  const expectedHash =
    typeof body.expectedHash === 'string' && body.expectedHash ? body.expectedHash : configResult.hash

  const writeResult = await writeCommonWorkspaceConfig(content, expectedHash)
  if (!writeResult.ok) {
    const status = writeResult.error === 'conflict' ? 409 : 500
    return NextResponse.json({ error: writeResult.error ?? 'write_failed' }, { status })
  }

  await auditEvent({
    actorUserId: session.user.id,
    action: 'agent.updated',
    metadata: { slug, agentId: name },
  })

  const agent = getAgentSummaries(nextConfig).find((entry) => entry.id === name)
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({
    agent: {
      id: agent.id,
      displayName: agent.displayName,
      description: agent.description,
      model: agent.model,
      temperature: agent.temperature,
      prompt: agent.prompt,
      isPrimary: agent.isPrimary,
      capabilities: agent.capabilities,
    },
    hash: writeResult.hash,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; name: string }> }
): Promise<NextResponse<{ hash?: string } | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug, name } = await params

  let body: UpdateAgentRequest | null = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const configResult = await loadCommonConfig()
  if (!configResult.ok) {
    const status =
      configResult.error === 'not_found' ? 404 : configResult.error === 'kb_unavailable' ? 503 : 500
    return NextResponse.json({ error: configResult.error }, { status })
  }

  const agent = configResult.config.agent?.[name]
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (configResult.config.default_agent === name || agent.mode === 'primary') {
    return NextResponse.json({ error: 'primary_agent' }, { status: 409 })
  }

  const remaining = { ...configResult.config.agent }
  delete remaining[name]

  if (Object.keys(remaining).length === 0) {
    return NextResponse.json({ error: 'last_agent' }, { status: 409 })
  }

  const nextConfig: CommonWorkspaceConfig = {
    ...configResult.config,
    agent: remaining,
  }

  const validation = validateCommonWorkspaceConfig(nextConfig)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error ?? 'invalid_config' }, { status: 400 })
  }

  const content = JSON.stringify(nextConfig, null, 2)
  const expectedHash =
    body && typeof body.expectedHash === 'string' && body.expectedHash ? body.expectedHash : configResult.hash

  const writeResult = await writeCommonWorkspaceConfig(content, expectedHash)
  if (!writeResult.ok) {
    const status = writeResult.error === 'conflict' ? 409 : 500
    return NextResponse.json({ error: writeResult.error ?? 'write_failed' }, { status })
  }

  await auditEvent({
    actorUserId: session.user.id,
    action: 'agent.deleted',
    metadata: { slug, agentId: name },
  })

  return NextResponse.json({ hash: writeResult.hash })
}
