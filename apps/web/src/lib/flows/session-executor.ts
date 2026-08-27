import { FlowRunStatus } from '@prisma/client'

import {
  captureSessionMessageCursor,
  readLatestAssistantText,
  waitForSessionToComplete,
  type SessionExecutionClient,
} from '@/lib/opencode/session-execution'
import { flowService, messageRunService } from '@/lib/services'

const LEASE_EXTENSION_INTERVAL_MS = 60_000
const FLOW_MCP_READINESS_DIRECTORY = '/workspace'
const FLOW_MCP_READINESS_INITIAL_DELAY_MS = 250
const FLOW_MCP_READINESS_MAX_ATTEMPTS = 30
const FLOW_MCP_READINESS_MAX_DELAY_MS = 2_000
const FLOW_MCP_READINESS_MAX_TIMEOUT_MS = 30_000
const FLOW_MCP_READINESS_STATUS_TIMEOUT_MS = 2_000
const FLOW_MCP_READINESS_TIMEOUT_MS = 15_000
export const FLOW_LEASE_MS = 15 * 60 * 1000
export const FLOW_RUN_CANCELLED_ERROR = 'flow_run_cancelled'

type PromptModel = {
  modelID: string
  providerID: string
}

type RuntimeAgent = {
  model?: PromptModel
  name?: string
}

type RuntimeProvider = {
  id?: string
  models?: Record<string, unknown>
}

type RuntimeConfig = {
  mcpServerKeys: string[]
}

export type FlowConnectorDeclaration = {
  displayName?: string
  id: string
}

export type FlowPromptResult =
  | { ok: true; output: string }
  | { ok: false; type: 'failed'; error: string }
  | { ok: false; type: 'termination_unconfirmed'; cause: string }

type RuntimeClientWithConfig = SessionExecutionClient & {
  app?: {
    agents?: (parameters?: unknown, options?: unknown) => Promise<{ data?: unknown }>
  }
  config?: {
    get?: (parameters?: unknown, options?: unknown) => Promise<{ data?: unknown }>
    providers?: (parameters?: unknown, options?: unknown) => Promise<{ data?: unknown }>
  }
  mcp?: {
    status?: (parameters?: unknown, options?: unknown) => Promise<{ data?: unknown }>
  }
}

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  // Keep runtime imports out of Next/Vitest static module transforms.
  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readAgentModel(agent: unknown): PromptModel | null {
  if (!isRecord(agent) || !isRecord(agent.model)) return null

  const providerID = agent.model.providerID
  const modelID = agent.model.modelID
  if (typeof providerID !== 'string' || typeof modelID !== 'string') return null

  return { modelID, providerID }
}

function readRuntimeAgents(data: unknown): RuntimeAgent[] {
  if (!Array.isArray(data)) return []

  return data.flatMap((agent) => {
    if (!isRecord(agent)) return []
    const name = typeof agent.name === 'string' ? agent.name : undefined
    const model = readAgentModel(agent) ?? undefined
    return [{ model, name }]
  })
}

function readRuntimeProviders(data: unknown): RuntimeProvider[] {
  if (!isRecord(data) || !Array.isArray(data.providers)) return []

  return data.providers.flatMap((provider) => {
    if (!isRecord(provider)) return []
    const id = typeof provider.id === 'string' ? provider.id : undefined
    const models = isRecord(provider.models) ? provider.models : undefined
    return [{ id, models }]
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('operation_timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function readRuntimeConfig(data: unknown): RuntimeConfig {
  if (!isRecord(data)) return { mcpServerKeys: [] }

  return {
    mcpServerKeys: isRecord(data.mcp)
      ? Object.keys(data.mcp).filter((serverKey) => serverKey.startsWith('arche_')).sort()
      : [],
  }
}

type RequiredConnectorEntry = {
  declarationId: string
  serverKey: string | null
}

function resolveRequiredConnectorEntries(input: {
  declarations: FlowConnectorDeclaration[]
  mcpServerKeys: string[]
}): RequiredConnectorEntry[] {
  // Connector ids are cuid-style and contain no underscores, so the trailing
  // segment of an `arche_<type>_<id>` server key identifies them unambiguously.
  return input.declarations.map((declaration) => ({
    declarationId: declaration.id,
    serverKey: input.mcpServerKeys.find((key) => key.endsWith(`_${declaration.id}`)) ?? null,
  }))
}

function getUnavailableDeclarationIds(
  data: unknown,
  required: RequiredConnectorEntry[],
): string[] {
  const status = isRecord(data) ? data : {}
  return required
    .filter((entry) => {
      if (!entry.serverKey) return true
      const connectorStatus = status[entry.serverKey]
      return !isRecord(connectorStatus) || connectorStatus.status !== 'connected'
    })
    .map((entry) => entry.declarationId)
}

async function getUnavailableMcpConnectorError(params: {
  client: SessionExecutionClient
  maxAttempts?: number
  initialDelayMs?: number
  requiredConnectors?: FlowConnectorDeclaration[]
  statusTimeoutMs?: number
  timeoutMs?: number
}): Promise<string | null> {
  const declarations = params.requiredConnectors ?? []
  if (declarations.length === 0) return null

  const client = params.client as RuntimeClientWithConfig
  if (!client.config?.get || !client.mcp?.status) return null

  let runtimeConfig: RuntimeConfig
  try {
    const configResult = await client.config.get(
      { directory: FLOW_MCP_READINESS_DIRECTORY },
      { throwOnError: true },
    )
    runtimeConfig = readRuntimeConfig(configResult.data)
  } catch {
    return null
  }

  const requiredEntries = resolveRequiredConnectorEntries({
    declarations,
    mcpServerKeys: runtimeConfig.mcpServerKeys,
  })
  const describeUnavailableConnector = (declarationId: string): string => {
    const declaration = declarations.find((candidate) => candidate.id === declarationId)
    const serverKey = requiredEntries.find((entry) => entry.declarationId === declarationId)?.serverKey
    return declaration?.displayName ?? serverKey ?? declarationId
  }
  const timeoutMs = Math.min(
    FLOW_MCP_READINESS_MAX_TIMEOUT_MS,
    Math.max(0, params.timeoutMs ?? FLOW_MCP_READINESS_TIMEOUT_MS),
  )
  const initialDelayMs = Math.max(1, params.initialDelayMs ?? FLOW_MCP_READINESS_INITIAL_DELAY_MS)
  const maxAttempts = Math.min(
    FLOW_MCP_READINESS_MAX_ATTEMPTS,
    Math.max(1, params.maxAttempts ?? FLOW_MCP_READINESS_MAX_ATTEMPTS),
  )
  const statusTimeoutMs = Math.min(
    FLOW_MCP_READINESS_STATUS_TIMEOUT_MS,
    Math.max(1, params.statusTimeoutMs ?? FLOW_MCP_READINESS_STATUS_TIMEOUT_MS),
  )
  const deadline = Date.now() + timeoutMs
  let delayMs = initialDelayMs
  let unavailableDeclarationIds = requiredEntries.map((entry) => entry.declarationId)
  let attempts = 0

  while (attempts < maxAttempts) {
    attempts += 1
    try {
      const statusResult = await withTimeout(
        client.mcp.status(
          { directory: FLOW_MCP_READINESS_DIRECTORY },
          { throwOnError: true },
        ),
        statusTimeoutMs,
      )
      unavailableDeclarationIds = getUnavailableDeclarationIds(statusResult.data, requiredEntries)
      if (unavailableDeclarationIds.length === 0) return null
    } catch {
      unavailableDeclarationIds = requiredEntries.map((entry) => entry.declarationId)
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0 || attempts >= maxAttempts) {
      return `flow_mcp_connector_unavailable:${describeUnavailableConnector(unavailableDeclarationIds[0] ?? declarations[0].id)}`
    }

    await sleep(Math.min(delayMs, remainingMs))
    delayMs = Math.min(delayMs * 2, FLOW_MCP_READINESS_MAX_DELAY_MS)
  }

  return `flow_mcp_connector_unavailable:${describeUnavailableConnector(unavailableDeclarationIds[0] ?? declarations[0].id)}`
}

async function getUnavailableAgentModelError(params: {
  agent: string | null | undefined
  client: SessionExecutionClient
}): Promise<string | null> {
  if (!params.agent) return null

  const client = params.client as RuntimeClientWithConfig
  if (!client.app?.agents || !client.config?.providers) return null

  try {
    const agentsResult = await client.app.agents({}, { throwOnError: true })
    const agent = readRuntimeAgents(agentsResult.data).find((entry) => entry.name === params.agent)
    if (!agent?.model) return null

    const providersResult = await client.config.providers({}, { throwOnError: true })
    const provider = readRuntimeProviders(providersResult.data).find((entry) => entry.id === agent.model?.providerID)
    if (provider?.models && Object.prototype.hasOwnProperty.call(provider.models, agent.model.modelID)) {
      return null
    }

    return `flow_agent_model_unavailable:${params.agent}:${agent.model.providerID}/${agent.model.modelID}`
  } catch {
    return null
  }
}

export async function createFlowLeaseOwner(): Promise<string> {
  const { randomUUID } = await importRuntimeModule<typeof import('crypto')>('crypto')
  return `flows:${process.pid}:${randomUUID()}`
}

export async function runFlowPromptAndReadOutput(params: {
  agent?: string | null
  client: SessionExecutionClient
  flowId: string
  leaseOwner: string
  prompt: string
  requiredConnectors?: FlowConnectorDeclaration[]
  runId: string
  sessionId: string
  slug: string
  userId?: string
  mcpReadinessMaxAttempts?: number
  mcpReadinessInitialDelayMs?: number
  mcpReadinessStatusTimeoutMs?: number
  mcpReadinessTimeoutMs?: number
}): Promise<FlowPromptResult> {
  const existingRun = await flowService.findRunStatusById(params.runId)
  if (existingRun?.status === FlowRunStatus.cancelled) {
    return { ok: false, type: 'failed', error: FLOW_RUN_CANCELLED_ERROR }
  }

  const unavailableAgentModel = await getUnavailableAgentModelError({
    agent: params.agent,
    client: params.client,
  })
  if (unavailableAgentModel) {
    return { ok: false, type: 'failed', error: unavailableAgentModel }
  }

  const unavailableMcpConnector = await getUnavailableMcpConnectorError({
    client: params.client,
    initialDelayMs: params.mcpReadinessInitialDelayMs,
    maxAttempts: params.mcpReadinessMaxAttempts,
    requiredConnectors: params.requiredConnectors,
    statusTimeoutMs: params.mcpReadinessStatusTimeoutMs,
    timeoutMs: params.mcpReadinessTimeoutMs,
  })
  if (unavailableMcpConnector) {
    return { ok: false, type: 'failed', error: unavailableMcpConnector }
  }

  let messageRunId: string | null = null
  if (params.userId) {
    const runResult = await messageRunService.createActiveRunAfterRuntimeStateCheck({
      readRuntimeSessionState: async () => {
        const statusResult = await params.client.session.status({}, { throwOnError: true })
        const sessionStatus = statusResult.data?.[params.sessionId]
        if (sessionStatus?.type === 'busy' || sessionStatus?.type === 'retry') return 'busy'
        if (!sessionStatus || sessionStatus.type === 'idle') return 'idle'
        return 'unknown'
      },
      sessionId: params.sessionId,
      slug: params.slug,
      source: 'flow',
    })
    if (!runResult.ok) {
      return { ok: false, type: 'failed', error: 'session_busy' }
    }
    messageRunId = runResult.run.id
  }

  let cursor: Awaited<ReturnType<typeof captureSessionMessageCursor>>
  try {
    cursor = await captureSessionMessageCursor(params.client, params.sessionId)
    await params.client.session.promptAsync(
      {
        agent: params.agent ?? undefined,
        parts: [{ text: params.prompt, type: 'text' }],
        sessionID: params.sessionId,
      },
      { throwOnError: true },
    )
  } catch (error) {
    if (messageRunId) {
      await messageRunService.markRunFailed(
        messageRunId,
        error instanceof Error ? error.message : 'flow_prompt_failed',
      ).catch(() => undefined)
    }
    throw error
  }

  let lastLeaseExtensionAt = 0
  const getCancellationFailure = async (): Promise<string | null> => {
    const run = await flowService.findRunStatusById(params.runId)
    if (run?.status !== FlowRunStatus.cancelled) return null

    return FLOW_RUN_CANCELLED_ERROR
  }

  const completion = await waitForSessionToComplete({
    client: params.client,
    cursor,
    onPulse: async () => {
      const cancellation = await getCancellationFailure()
      if (cancellation) return cancellation

      if (Date.now() - lastLeaseExtensionAt < LEASE_EXTENSION_INTERVAL_MS) {
        return
      }

      const result = await flowService.extendFlowLease(
        params.flowId,
        params.leaseOwner,
        new Date(Date.now() + FLOW_LEASE_MS),
      )
      if (result.count !== 1) return 'flow_lease_lost'
      lastLeaseExtensionAt = Date.now()
    },
    sessionId: params.sessionId,
    slug: params.slug,
    usage: params.userId && messageRunId
      ? { messageRunId, source: 'flow', userId: params.userId }
      : undefined,
  })

  if (completion.status === 'termination_unconfirmed') {
    return { ok: false, type: 'termination_unconfirmed', cause: completion.cause }
  }

  if (completion.status === 'failed') {
    if (messageRunId) {
      await messageRunService.markRunFailed(messageRunId, completion.error).catch(() => undefined)
    }
    return { ok: false, type: 'failed', error: completion.error }
  }

  if (messageRunId) {
    await messageRunService.markRunSucceeded(messageRunId).catch(() => undefined)
  }

  const output = await readLatestAssistantText(params.client, params.sessionId, cursor)
  if (!output) {
    return { ok: false, type: 'failed', error: 'flow_no_assistant_output' }
  }

  return { ok: true, output }
}
