import { FlowRunStatus } from '@prisma/client'

import type { HarnessRuntime } from '@/lib/harness/contract'
import {
  captureSessionMessageCursor,
  createSessionPromptRun,
  describeLatestAssistantReply,
  readSessionFamilyRuntimeState,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/harness/execution'
import { flowService, messageRunService } from '@/lib/services'

const LEASE_EXTENSION_INTERVAL_MS = 60_000
const FLOW_MCP_READINESS_INITIAL_DELAY_MS = 250
const FLOW_MCP_READINESS_MAX_ATTEMPTS = 30
const FLOW_MCP_READINESS_MAX_DELAY_MS = 2_000
const FLOW_MCP_READINESS_MAX_TIMEOUT_MS = 30_000
const FLOW_MCP_READINESS_STATUS_TIMEOUT_MS = 2_000
const FLOW_MCP_READINESS_TIMEOUT_MS = 15_000
export const FLOW_LEASE_MS = 15 * 60 * 1000
export const FLOW_RUN_CANCELLED_ERROR = 'flow_run_cancelled'

export type FlowConnectorDeclaration = {
  displayName?: string
  id: string
}

export type FlowPromptResult =
  | { ok: true; output: string }
  | { ok: false; type: 'failed'; error: string }
  | { ok: false; type: 'termination_unconfirmed'; cause: string }

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  // Keep runtime imports out of Next/Vitest static module transforms.
  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
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
  status: Record<string, boolean>,
  required: RequiredConnectorEntry[],
): string[] {
  return required
    .filter((entry) => {
      if (!entry.serverKey) return true
      return status[entry.serverKey] !== true
    })
    .map((entry) => entry.declarationId)
}

async function getUnavailableMcpConnectorError(params: {
  client: HarnessRuntime
  maxAttempts?: number
  initialDelayMs?: number
  requiredConnectors?: FlowConnectorDeclaration[]
  statusTimeoutMs?: number
  timeoutMs?: number
}): Promise<string | null> {
  const declarations = params.requiredConnectors ?? []
  if (declarations.length === 0) return null

  const client = params.client
  let mcpServerKeys: string[]
  try {
    const configResult = await client.listConnectorKeys()
    if (!configResult.ok) return null
    mcpServerKeys = configResult.data
  } catch {
    return null
  }

  const requiredEntries = resolveRequiredConnectorEntries({
    declarations,
    mcpServerKeys,
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
        client.listConnectorStatus(),
        statusTimeoutMs,
      )
      unavailableDeclarationIds = statusResult.ok
        ? getUnavailableDeclarationIds(statusResult.data, requiredEntries)
        : requiredEntries.map((entry) => entry.declarationId)
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
  client: HarnessRuntime
}): Promise<string | null> {
  if (!params.agent) return null

  const client = params.client
  try {
    const agentsResult = await client.listAgents()
    if (!agentsResult.ok) return null
    const agent = agentsResult.data.find((entry) => entry.id === params.agent)
    if (!agent?.model) return null

    const modelsResult = await client.listModels()
    if (!modelsResult.ok) return null
    const agentModel = agent.model
    if (modelsResult.data.some((model) => model.providerId === agentModel.providerId && model.modelId === agentModel.modelId)) {
      return null
    }

    return `flow_agent_model_unavailable:${params.agent}:${agent.model.providerId}/${agent.model.modelId}`
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
  client: HarnessRuntime
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
    const runResult = await createSessionPromptRun({
      client: params.client,
      sessionId: params.sessionId,
      slug: params.slug,
      source: 'flow',
    })
    if (!runResult.ok) {
      return { ok: false, type: 'failed', error: runResult.error }
    }
    messageRunId = runResult.run.id
  } else {
    const state = await readSessionFamilyRuntimeState(params.client, params.sessionId)
    if (state !== 'idle') return { ok: false, type: 'failed', error: state === 'not_found' ? 'session_not_found' : 'session_busy' }
  }

  let cursor: Awaited<ReturnType<typeof captureSessionMessageCursor>>
  try {
    cursor = await captureSessionMessageCursor(params.client, params.sessionId)
    const submitted = await params.client.prompt({
      agent: params.agent ?? undefined,
      parts: [{ text: params.prompt, type: 'text' }],
      sessionId: params.sessionId,
    })
    if (!submitted.ok) throw new Error(submitted.error.code)
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
    // Termination could not be confirmed, so the flow run stays preserved for
    // lease-expiry recovery — but this run's message run is definitively over
    // (abort was requested); leaving it `running` would block provider syncs
    // until the 35-minute message-run timeout.
    if (messageRunId) {
      await messageRunService.markRunFailed(messageRunId, completion.cause).catch(() => undefined)
    }
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
    const diagnostics = await describeLatestAssistantReply({
      client: params.client,
      cursor,
      sessionId: params.sessionId,
    }).catch(() => null)

    if (diagnostics) {
      console.warn('[flows] Step completed without assistant output', { ...diagnostics })
    }

    // Suffix mirrors flow_mcp_connector_unavailable:<name>: the code stays
    // stable while naming the model and the part-type profile it returned
    // (reasoning-only, tool-only, empty).
    const suffix = diagnostics
      ? `:${diagnostics.providerId ?? 'unknown'}/${diagnostics.modelId ?? 'unknown'}:${diagnostics.partTypes.join('+') || 'none'}`
      : ''
    return { ok: false, type: 'failed', error: `flow_no_assistant_output${suffix}` }
  }

  return { ok: true, output }
}
