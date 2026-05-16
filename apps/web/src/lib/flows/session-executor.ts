import { FlowRunStatus } from '@prisma/client'

import {
  captureSessionMessageCursor,
  readLatestAssistantText,
  waitForSessionToComplete,
  type SessionExecutionClient,
} from '@/lib/opencode/session-execution'
import { flowService } from '@/lib/services'

const LEASE_EXTENSION_INTERVAL_MS = 60_000
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

type RuntimeClientWithConfig = SessionExecutionClient & {
  app?: {
    agents?: (parameters?: unknown, options?: unknown) => Promise<{ data?: unknown }>
  }
  config?: {
    providers?: (parameters?: unknown, options?: unknown) => Promise<{ data?: unknown }>
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
  runId: string
  sessionId: string
  slug: string
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const existingRun = await flowService.findRunStatusById(params.runId)
  if (existingRun?.status === FlowRunStatus.cancelled) {
    return { ok: false, error: FLOW_RUN_CANCELLED_ERROR }
  }

  const unavailableAgentModel = await getUnavailableAgentModelError({
    agent: params.agent,
    client: params.client,
  })
  if (unavailableAgentModel) {
    return { ok: false, error: unavailableAgentModel }
  }

  const cursor = await captureSessionMessageCursor(params.client, params.sessionId)
  await params.client.session.promptAsync(
    {
      agent: params.agent ?? undefined,
      parts: [{ text: params.prompt, type: 'text' }],
      sessionID: params.sessionId,
    },
    { throwOnError: true },
  )

  let lastLeaseExtensionAt = 0
  const abortIfCancelled = async (): Promise<string | null> => {
    const run = await flowService.findRunStatusById(params.runId)
    if (run?.status !== FlowRunStatus.cancelled) return null

    await Promise.resolve(params.client.session.abort({ sessionID: params.sessionId })).catch((error) => {
      console.warn('[flows] Failed to abort cancelled flow session', {
        error,
        runId: params.runId,
        sessionId: params.sessionId,
      })
    })
    return FLOW_RUN_CANCELLED_ERROR
  }

  const failure = await waitForSessionToComplete({
    client: params.client,
    cursor,
    onPulse: async () => {
      const cancellation = await abortIfCancelled()
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
  })

  if (failure) {
    return { ok: false, error: failure }
  }

  const output = await readLatestAssistantText(params.client, params.sessionId, cursor)
  if (!output) {
    return { ok: false, error: 'flow_no_assistant_output' }
  }

  return { ok: true, output }
}
