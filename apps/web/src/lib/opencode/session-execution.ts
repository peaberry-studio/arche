import { createInstanceClient } from '@/lib/opencode/client'
import { ensureProviderAccessFreshForExecution } from '@/lib/opencode/providers'
import { transformParts } from '@/lib/opencode/transform'
import type { MessagePart } from '@/lib/opencode/types'
import { isProviderId, normalizeProviderId } from '@/lib/providers/catalog'
import { recordProviderRunUsageBestEffort } from '@/lib/providers/run-usage'
import type { ProviderId } from '@/lib/providers/types'
import { instanceService, messageRunService } from '@/lib/services'
import type { ActiveRunRuntimeState } from '@/lib/services/message-run'
import { getInstanceStatus, startInstance } from '@/lib/spawner/core'
import { deriveWorkspaceMessageRuntimeState } from '@/lib/workspace-message-state'

const RUN_POLL_INTERVAL_MS = 2_000
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const ACTIVITY_TOUCH_INTERVAL_MS = 20_000
const INSTANCE_START_POLL_INTERVAL_MS = 2_000
const IDLE_WITHOUT_ASSISTANT_GRACE_MS = 15_000

export type SessionExecutionClient = NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
export type SessionMessageCursor = {
  messageCount: number
}

export type SessionPromptRunResult = Awaited<ReturnType<typeof messageRunService.createActiveRunAfterRuntimeStateCheck>>

type SessionRunUsageInput = {
  messageRunId: string
  source: string
  userId: string
}

type SessionRunUsage = {
  costUsd: number
  inputTokens: number
  outputTokens: number
  providerId: ProviderId
  modelId: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeRole(role: unknown): 'assistant' | 'system' | 'user' | null {
  if (role === 'assistant' || role === 'system' || role === 'user') {
    return role
  }

  return null
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function parseStatus(status: unknown): number | null {
  if (typeof status === 'number') {
    return status
  }

  if (typeof status === 'string') {
    const parsed = Number.parseInt(status, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function getNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function extractSessionRunUsage(messages: ReturnType<typeof getMessagesSinceCursor>): SessionRunUsage | null {
  let providerId: ProviderId | null = null
  let modelId: string | null = null
  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const message of messages) {
    if (normalizeRole(message.info.role) !== 'assistant') {
      continue
    }

    const rawProviderId = (message.info as { providerID?: unknown }).providerID
    if (typeof rawProviderId === 'string') {
      const normalizedProviderId = normalizeProviderId(rawProviderId)
      if (isProviderId(normalizedProviderId)) {
        providerId = normalizedProviderId
      }
    }

    const rawModelId = (message.info as { modelID?: unknown }).modelID
    if (typeof rawModelId === 'string' && rawModelId.trim()) {
      modelId = rawModelId.trim()
    }

    for (const part of transformParts(message.parts ?? [])) {
      if (part.type !== 'step-finish') {
        continue
      }

      costUsd += getNumber(part.cost)
      inputTokens += getNumber(part.tokens.input)
      outputTokens += getNumber(part.tokens.output)
    }
  }

  if (!providerId || (costUsd <= 0 && inputTokens <= 0 && outputTokens <= 0)) {
    return null
  }

  return { costUsd, inputTokens, modelId, outputTokens, providerId }
}

function recordSessionRunUsageBestEffort(input: {
  messages: ReturnType<typeof getMessagesSinceCursor>
  usage: SessionRunUsageInput | undefined
}): void {
  if (!input.usage) return

  const usageInput = input.usage

  const usage = extractSessionRunUsage(input.messages)
  if (!usage) return

  recordProviderRunUsageBestEffort({
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    messageRunId: usageInput.messageRunId,
    modelId: usage.modelId,
    outputTokens: usage.outputTokens,
    providerId: usage.providerId,
    source: usageInput.source,
    userId: usageInput.userId,
  }, '[opencode/session-execution]')
}

function firstString(values: unknown[]): string | null {
  const value = values.find((item) => typeof item === 'string')
  return typeof value === 'string' ? value : null
}

export function isOpenCodeSessionNotFoundError(error: unknown): boolean {
  const record = toRecord(error)
  const response = toRecord(record?.response)
  const cause = toRecord(record?.cause)
  const status = parseStatus(
    record?.status ?? record?.statusCode ?? response?.status ?? response?.statusCode,
  )
  if (status === 404) {
    return true
  }

  const code = firstString([
    record?.code,
    record?.name,
    cause?.code,
    cause?.name,
  ])
  if (code && /session.*not.*found|session_not_found/i.test(code)) {
    return true
  }

  const message = firstString([
    error instanceof Error ? error.message : error,
    record?.message,
    record?.statusText,
    response?.message,
    response?.statusText,
    cause?.message,
  ]) ?? ''

  return /session.*not\s*found|session.*missing|no session.*found|404.*session/i.test(message)
}

function getMessagesSinceCursor(
  messages: Awaited<ReturnType<SessionExecutionClient['session']['messages']>>['data'] | undefined,
  cursor?: SessionMessageCursor,
) {
  const allMessages = messages ?? []
  if (!cursor) {
    return allMessages
  }

  return allMessages.slice(cursor.messageCount)
}

function extractAssistantReplyText(parts: unknown[]): string {
  return transformParts(parts)
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function extractAssistantFailure(messages: ReturnType<typeof getMessagesSinceCursor>): string | null {
  const assistantMessages = messages.filter((message) => normalizeRole(message.info.role) === 'assistant')
  const latestAssistant = assistantMessages[assistantMessages.length - 1]
  if (!latestAssistant) {
    return null
  }

  const error = (latestAssistant.info as { error?: unknown }).error
  if (!error || typeof error !== 'object') {
    return null
  }

  const errorRecord = error as {
    data?: { message?: unknown }
    name?: unknown
  }
  const errorName = typeof errorRecord.name === 'string' ? errorRecord.name : null
  const errorMessage =
    typeof errorRecord.data?.message === 'string' ? errorRecord.data.message : null

  if (
    errorName === 'ProviderAuthError' ||
    (errorMessage && /api key is missing|provider credential|configure .*provider/i.test(errorMessage))
  ) {
    return 'provider_auth_missing'
  }

  return null
}

async function inspectSessionOutcome(
  client: SessionExecutionClient,
  sessionId: string,
  cursor?: SessionMessageCursor,
): Promise<string | null> {
  const response = await client.session.messages(
    { sessionID: sessionId },
    { throwOnError: true },
  )
  const messages = getMessagesSinceCursor(response.data, cursor)
  const assistantFailure = extractAssistantFailure(messages)
  if (assistantFailure) {
    return assistantFailure
  }

  const assistantMessages = messages.filter((message) => normalizeRole(message.info.role) === 'assistant')

  if (assistantMessages.length === 0) {
    return 'flow_no_assistant_message'
  }

  const latestAssistant = assistantMessages[assistantMessages.length - 1]
  const completedAt = (latestAssistant.info.time as { completed?: number } | undefined)?.completed
  const parts = transformParts(latestAssistant.parts ?? [])
  const runtimeState = deriveWorkspaceMessageRuntimeState({
    role: 'assistant',
    completedAt,
    parts,
    sessionStatus: 'idle',
  })

  if (runtimeState.pending) {
    return 'flow_session_pending'
  }

  if (runtimeState.statusInfo?.status === 'error') {
    return runtimeState.statusInfo.detail ?? 'flow_run_failed'
  }

  return null
}

export async function ensureWorkspaceRunningForExecution(slug: string, userId: string): Promise<void> {
  const current = await getInstanceStatus(slug)
  if (current?.status === 'running') {
    await ensureProviderAccessFreshForExecution({ slug, userId })
    return
  }

  if (current?.status === 'starting') {
    const deadline = Date.now() + RUN_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(INSTANCE_START_POLL_INTERVAL_MS)
      const next = await getInstanceStatus(slug)
      if (next?.status === 'running') {
        await ensureProviderAccessFreshForExecution({ slug, userId })
        return
      }
    }

    throw new Error('instance_start_timeout')
  }

  const startResult = await startInstance(slug, userId)
  if (!startResult.ok && startResult.error !== 'already_running') {
    throw new Error(startResult.detail ?? startResult.error)
  }

  await ensureProviderAccessFreshForExecution({ slug, userId })
}

export async function captureSessionMessageCursor(
  client: SessionExecutionClient,
  sessionId: string,
): Promise<SessionMessageCursor> {
  const response = await client.session.messages(
    { sessionID: sessionId },
    { throwOnError: true },
  )

  return {
    messageCount: response.data?.length ?? 0,
  }
}

export async function createSessionPromptRun(params: {
  client: SessionExecutionClient
  sessionId: string
  slug: string
  source: string
}): Promise<SessionPromptRunResult> {
  return messageRunService.createActiveRunAfterRuntimeStateCheck({
    readRuntimeSessionState: async (): Promise<ActiveRunRuntimeState> => {
      const statusResult = await params.client.session.status({}, { throwOnError: true })
      const sessionStatus = statusResult.data?.[params.sessionId]
      if (sessionStatus?.type === 'busy' || sessionStatus?.type === 'retry') {
        return 'busy'
      }
      if (!sessionStatus || sessionStatus.type === 'idle') {
        return 'idle'
      }

      return 'unknown'
    },
    slug: params.slug,
    sessionId: params.sessionId,
    source: params.source,
  })
}

export async function waitForSessionToComplete(params: {
  client: SessionExecutionClient
  cursor?: SessionMessageCursor
  sessionId: string
  slug: string
  onPulse?: () => Promise<string | null | void>
  usage?: SessionRunUsageInput
}): Promise<string | null> {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  const startedAt = Date.now()
  let lastActivityTouchAt = 0
  let assistantSeen = false

  while (Date.now() < deadline) {
    if (Date.now() - lastActivityTouchAt >= ACTIVITY_TOUCH_INTERVAL_MS) {
      await instanceService.touchActivity(params.slug).catch(() => undefined)
      lastActivityTouchAt = Date.now()
    }

    const pulseFailure = await params.onPulse?.().catch(() => null)
    if (pulseFailure) return pulseFailure

    const [statusResult, messagesResult] = await Promise.all([
      params.client.session.status({}, { throwOnError: true }),
      params.client.session.messages({ sessionID: params.sessionId }, { throwOnError: true }),
    ])

    const sessionStatus = statusResult.data?.[params.sessionId]
    const messages = getMessagesSinceCursor(messagesResult.data, params.cursor)
    assistantSeen = assistantSeen || messages.some((message) => normalizeRole(message.info.role) === 'assistant')

    if ((sessionStatus?.type === 'idle' || !sessionStatus) && assistantSeen) {
      const outcome = await inspectSessionOutcome(params.client, params.sessionId, params.cursor)
      if (outcome === 'flow_session_pending') {
        await sleep(RUN_POLL_INTERVAL_MS)
        continue
      }

      if (!outcome) {
        recordSessionRunUsageBestEffort({ messages, usage: params.usage })
      }
      return outcome
    }

    if (
      (sessionStatus?.type === 'idle' || !sessionStatus) &&
      !assistantSeen &&
      Date.now() - startedAt >= IDLE_WITHOUT_ASSISTANT_GRACE_MS
    ) {
      return 'flow_no_assistant_message'
    }

    await sleep(RUN_POLL_INTERVAL_MS)
  }

  return 'flow_run_timeout'
}

export async function readLatestAssistantText(
  client: SessionExecutionClient,
  sessionId: string,
  cursor?: SessionMessageCursor,
): Promise<string | null> {
  const response = await client.session.messages(
    { sessionID: sessionId },
    { throwOnError: true },
  )
  const messages = getMessagesSinceCursor(response.data, cursor)

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (normalizeRole(message.info.role) !== 'assistant') {
      continue
    }

    const text = extractAssistantReplyText(message.parts ?? [])
    if (text) {
      return text
    }
  }

  return null
}
