import type { HarnessMessage, HarnessRuntime } from '@/lib/harness/contract'
import { EXECUTION_TERMINATION_UNCONFIRMED_ERROR, type HarnessResult } from '@/lib/harness/errors'
import { syncRuntimeProviderAccess } from '@/lib/harness/registry'
import { isProviderId, normalizeProviderId } from '@/lib/providers/catalog'
import { recordProviderRunUsageBestEffort } from '@/lib/providers/run-usage'
import type { ProviderId } from '@/lib/providers/types'
import { getWorkspaceStatus, startWorkspace } from '@/lib/runtime/workspace-host'
import { instanceService, messageRunService } from '@/lib/services'
import type { ActiveRunRuntimeState } from '@/lib/services/message-run'
import type { MessagePart } from '@/types/workspace-runtime'

const RUN_POLL_INTERVAL_MS = 2_000
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const ACTIVITY_TOUCH_INTERVAL_MS = 20_000
const INSTANCE_START_POLL_INTERVAL_MS = 2_000
const IDLE_WITHOUT_ASSISTANT_GRACE_MS = 15_000
const ABORT_CONFIRMATION_TIMEOUT_MS = 10_000

export { EXECUTION_TERMINATION_UNCONFIRMED_ERROR }

export type SessionCompletionResult =
  | { status: 'completed' }
  | { status: 'failed'; error: string }
  | { status: 'termination_unconfirmed'; cause: string }

export type SessionExecutionClient = HarnessRuntime
export type SessionMessageCursor = {
  messageCount: number
}

export type SessionPromptRunResult = Awaited<ReturnType<typeof messageRunService.createActiveRunAfterRuntimeStateCheck>>
  | { ok: false; error: 'session_not_found' }

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

function requireData<T>(result: HarnessResult<T>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.data
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
    if (normalizeRole(message.role) !== 'assistant') {
      continue
    }

    const rawProviderId = message.model?.providerId
    if (typeof rawProviderId === 'string') {
      const normalizedProviderId = normalizeProviderId(rawProviderId)
      if (isProviderId(normalizedProviderId)) {
        providerId = normalizedProviderId
      }
    }

    const rawModelId = message.model?.modelId
    if (typeof rawModelId === 'string' && rawModelId.trim()) {
      modelId = rawModelId.trim()
    }

    for (const part of message.parts) {
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
  }, '[harness/execution]')
}

async function recordLatestSessionRunUsageBestEffort(input: {
  client: SessionExecutionClient
  cursor?: SessionMessageCursor
  sessionId: string
  usage?: SessionRunUsageInput
}): Promise<void> {
  if (!input.usage) return

  const response = await input.client.listMessages(input.sessionId).catch(() => null)
  if (!response?.ok) return

  recordSessionRunUsageBestEffort({
    messages: getMessagesSinceCursor(response.data, input.cursor),
    usage: input.usage,
  })
}

function getMessagesSinceCursor(
  messages: HarnessMessage[],
  cursor?: SessionMessageCursor,
) {
  const allMessages = messages ?? []
  if (!cursor) {
    return allMessages
  }

  return allMessages.slice(cursor.messageCount)
}

function extractAssistantReplyText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

const ASSISTANT_FAILURE_DETAIL_MAX_LENGTH = 400

function extractAssistantFailure(messages: ReturnType<typeof getMessagesSinceCursor>): string | null {
  const assistantMessages = messages.filter((message) => normalizeRole(message.role) === 'assistant')
  const latestAssistant = assistantMessages[assistantMessages.length - 1]
  if (!latestAssistant) {
    return null
  }

  const error = latestAssistant.error
  if (!error) return null
  if (error.code === 'provider_auth_missing') return error.code

  // Errors that still produced visible output (e.g. a transient retry) keep
  // the previous tolerant behavior and do not fail the run.
  if (extractAssistantReplyText(latestAssistant.parts ?? [])) {
    return null
  }

  // Surface the runtime error (MessageAbortedError, APIError 400s, ...) so
  // callers store the real failure instead of a generic stream_incomplete.
  const detail = error.detail ?? error.code
  return detail.length > ASSISTANT_FAILURE_DETAIL_MAX_LENGTH
    ? `${detail.slice(0, ASSISTANT_FAILURE_DETAIL_MAX_LENGTH)}…`
    : detail
}

function inspectSessionOutcome(
  messages: ReturnType<typeof getMessagesSinceCursor>,
): string | null {
  const assistantFailure = extractAssistantFailure(messages)
  if (assistantFailure) {
    return assistantFailure
  }

  const assistantMessages = messages.filter((message) => normalizeRole(message.role) === 'assistant')

  if (assistantMessages.length === 0) {
    return 'flow_no_assistant_message'
  }

  const latestAssistant = assistantMessages[assistantMessages.length - 1]
  const parts = latestAssistant.parts
  let lastToolPart: Extract<MessagePart, { type: 'tool' }> | undefined
  for (const part of parts) {
    if (part.type === 'tool') {
      lastToolPart = part
    }
  }

  if (lastToolPart?.state.status === 'error') {
    return lastToolPart.state.error
  }

  return null
}

export async function ensureWorkspaceRunningForExecution(
  slug: string,
  userId: string,
  options: { forceProviderRefresh?: boolean } = {},
): Promise<void> {
  const current = await getWorkspaceStatus(slug)
  if (current?.status === 'running') {
    // Only the already-running path honors the flag: a freshly started
    // workspace was just synced, so it has no aged token to refresh.
    requireData(await syncRuntimeProviderAccess(slug, { userId, force: options.forceProviderRefresh }))
    return
  }

  if (current?.status === 'starting') {
    const deadline = Date.now() + RUN_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(INSTANCE_START_POLL_INTERVAL_MS)
      const next = await getWorkspaceStatus(slug)
      if (next?.status === 'running') {
        requireData(await syncRuntimeProviderAccess(slug, { userId }))
        return
      }
    }

    throw new Error('instance_start_timeout')
  }

  const startResult = await startWorkspace(slug, userId)
  if (!startResult.ok && startResult.error !== 'already_running') {
    throw new Error(startResult.detail ?? startResult.error)
  }

  requireData(await syncRuntimeProviderAccess(slug, { userId }))
}

export async function captureSessionMessageCursor(
  client: SessionExecutionClient,
  sessionId: string,
): Promise<SessionMessageCursor> {
  const messages = requireData(await client.listMessages(sessionId))

  return {
    messageCount: messages.length,
  }
}

export async function createSessionPromptRun(params: {
  client: SessionExecutionClient
  sessionId: string
  slug: string
  source: string
}): Promise<SessionPromptRunResult> {
  const readRuntimeSessionState = async (): Promise<ActiveRunRuntimeState> => {
    const state = await readSessionFamilyRuntimeState(params.client, params.sessionId)
    return state === 'not_found' ? 'unknown' : state
  }
  const state = await readSessionFamilyRuntimeState(params.client, params.sessionId)
  if (state === 'not_found') return { ok: false, error: 'session_not_found' }
  if (state !== 'idle') {
    return { ok: false, error: 'session_busy', activeRun: null }
  }
  return messageRunService.createActiveRunAfterRuntimeStateCheck({
    readRuntimeSessionState,
    slug: params.slug,
    sessionId: params.sessionId,
    source: params.source,
  })
}

type DescendantSessionDiscovery = {
  complete: boolean
  sessionIds: string[]
  missingRoot?: boolean
}

async function awaitBeforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | null> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    void promise.catch(() => undefined)
    return null
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), remainingMs)
    void promise.then(
      (result) => {
        clearTimeout(timeout)
        resolve(result)
      },
      () => {
        clearTimeout(timeout)
        resolve(null)
      },
    )
  })
}

async function listDescendantSessionIds(
  client: SessionExecutionClient,
  rootSessionId: string,
  deadline: number,
): Promise<DescendantSessionDiscovery> {
  const sessionIds = [rootSessionId]
  const visited = new Set(sessionIds)

  for (let index = 0; index < sessionIds.length; index += 1) {
    const parentSessionId = sessionIds[index]
    const response = await awaitBeforeDeadline(
      client.listChildren(parentSessionId),
      deadline,
    )
    if (!response?.ok) return { complete: false, sessionIds, missingRoot: index === 0 && response?.error.code === 'session_not_found' }

    for (const child of response.data ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      sessionIds.push(child.id)
    }
  }

  return { complete: true, sessionIds }
}

export async function readSessionFamilyRuntimeState(
  client: HarnessRuntime,
  sessionId: string,
): Promise<ActiveRunRuntimeState | 'not_found'> {
  const deadline = Date.now() + 8_000
  const discovery = await listDescendantSessionIds(client, sessionId, deadline)
  if (discovery.missingRoot) return 'not_found'
  if (!discovery.complete) return 'unknown'
  const response = await awaitBeforeDeadline(client.sessionStatus({ signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) }), deadline)
  if (!response?.ok) return 'unknown'
  if (discovery.sessionIds.some((id) => response.data[id]?.type === 'busy' || response.data[id]?.type === 'retry')) return 'busy'
  return discovery.sessionIds.every((id) => !response.data[id] || response.data[id].type === 'idle') ? 'idle' : 'unknown'
}

export async function abortSessionFamilyAndConfirmIdle(params: {
  client: SessionExecutionClient
  rootSessionId: string
}): Promise<boolean> {
  const deadline = Date.now() + ABORT_CONFIRMATION_TIMEOUT_MS
  const discovery = await listDescendantSessionIds(params.client, params.rootSessionId, deadline)

  // Abort sources are otherwise invisible when correlating runtime
  // MessageAbortedError reports against cancel calls.
  console.log('[harness/execution] Aborting session family', {
    rootSessionId: params.rootSessionId,
    sessionIds: discovery.sessionIds,
  })

  for (const sessionId of [...discovery.sessionIds].reverse()) {
    await awaitBeforeDeadline(
      params.client.abortSession(sessionId),
      deadline,
    )
  }

  if (!discovery.complete) {
    console.warn('[harness/execution] Session descendants could not be fully discovered', {
      rootSessionId: params.rootSessionId,
    })
    return false
  }

  while (Date.now() < deadline) {
    const response = await awaitBeforeDeadline(
      params.client.sessionStatus(),
      deadline,
    )
    if (response?.ok) {
      const allIdle = discovery.sessionIds.every((sessionId) => {
        const status = response.data?.[sessionId]
        return !status || status.type === 'idle'
      })
      if (allIdle) return true
    }

    await sleep(Math.min(RUN_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())))
  }

  console.warn('[harness/execution] Session abort was not confirmed', {
    rootSessionId: params.rootSessionId,
  })
  return false
}

export async function waitForSessionToComplete(params: {
  client: SessionExecutionClient
  cursor?: SessionMessageCursor
  sessionId: string
  slug: string
  onPulse?: () => Promise<string | null | void>
  usage?: SessionRunUsageInput
}): Promise<SessionCompletionResult> {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  const startedAt = Date.now()
  let lastActivityTouchAt = 0
  let fetchedIdleSnapshot = false

  while (Date.now() < deadline) {
    if (Date.now() - lastActivityTouchAt >= ACTIVITY_TOUCH_INTERVAL_MS) {
      await instanceService.touchActivity(params.slug).catch(() => undefined)
      lastActivityTouchAt = Date.now()
    }

    const pulseFailure = await params.onPulse?.().catch(() => null)
    if (pulseFailure) {
      await recordLatestSessionRunUsageBestEffort(params)
      const terminated = await abortSessionFamilyAndConfirmIdle({
        client: params.client,
        rootSessionId: params.sessionId,
      })
      return terminated
        ? { status: 'failed', error: pulseFailure }
        : { status: 'termination_unconfirmed', cause: pulseFailure }
    }

    const statuses = requireData(await params.client.sessionStatus())
    const sessionStatus = statuses[params.sessionId]

    if (sessionStatus?.type === 'busy' || sessionStatus?.type === 'retry') {
      fetchedIdleSnapshot = false
      await sleep(RUN_POLL_INTERVAL_MS)
      continue
    }

    if (sessionStatus?.type === 'idle' || !sessionStatus) {
      if (!fetchedIdleSnapshot) {
        const messages = getMessagesSinceCursor(requireData(await params.client.listMessages(params.sessionId)), params.cursor)
        const hasAssistant = messages.some((message) => normalizeRole(message.role) === 'assistant')

        if (hasAssistant) {
          const outcome = inspectSessionOutcome(messages)
          recordSessionRunUsageBestEffort({ messages, usage: params.usage })
          return outcome ? { status: 'failed', error: outcome } : { status: 'completed' }
        }

        fetchedIdleSnapshot = true
      }

      if (Date.now() - startedAt >= IDLE_WITHOUT_ASSISTANT_GRACE_MS) {
        await recordLatestSessionRunUsageBestEffort(params)
        return { status: 'failed', error: 'flow_no_assistant_message' }
      }
    }

    await sleep(RUN_POLL_INTERVAL_MS)
  }

  await recordLatestSessionRunUsageBestEffort(params)
  const terminated = await abortSessionFamilyAndConfirmIdle({
    client: params.client,
    rootSessionId: params.sessionId,
  })
  return terminated
    ? { status: 'failed', error: 'flow_run_timeout' }
    : { status: 'termination_unconfirmed', cause: 'flow_run_timeout' }
}

export async function readLatestAssistantText(
  client: SessionExecutionClient,
  sessionId: string,
  cursor?: SessionMessageCursor,
): Promise<string | null> {
  const messages = getMessagesSinceCursor(requireData(await client.listMessages(sessionId)), cursor)

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (normalizeRole(message.role) !== 'assistant') {
      continue
    }

    const text = extractAssistantReplyText(message.parts ?? [])
    if (text) {
      return text
    }
  }

  return null
}

export type LatestAssistantReplyDiagnostics = {
  agent: string | null
  assistantMessageCount: number
  messageCount: number
  modelId: string | null
  partTypes: string[]
  providerId: string | null
}

// Diagnostics for runs that completed without assistant text: the message
// metadata and part-type profile distinguish reasoning-only, tool-only, and
// truly empty model responses.
export async function describeLatestAssistantReply(params: {
  client: SessionExecutionClient
  cursor?: SessionMessageCursor
  sessionId: string
}): Promise<LatestAssistantReplyDiagnostics> {
  const messages = getMessagesSinceCursor(requireData(await params.client.listMessages(params.sessionId)), params.cursor)
  const assistantMessages = messages.filter((message) => normalizeRole(message.role) === 'assistant')
  const partTypes = new Set<string>()
  for (const message of assistantMessages) {
    for (const part of message.parts) {
      partTypes.add(part.type)
    }
  }

  const latest = assistantMessages[assistantMessages.length - 1]

  return {
    agent: latest?.agentId?.trim() || null,
    assistantMessageCount: assistantMessages.length,
    messageCount: messages.length,
    modelId: latest?.model?.modelId?.trim() || null,
    partTypes: [...partTypes].sort(),
    providerId: latest?.model?.providerId?.trim() || null,
  }
}
