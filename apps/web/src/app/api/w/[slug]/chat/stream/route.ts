import { randomUUID } from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'

import { getIdleFinalizationOutcome, getSilentStreamOutcome } from '@/app/api/w/[slug]/chat/stream/watchdog'
import { createUpstreamSessionStatusReader } from '@/app/api/w/[slug]/chat/stream/status-reader'
import { AUTO_LEARNING_MIN_MESSAGES, canQueueAutoLearningRun, dispatchLearningRunExecution, maybeQueueAutoLearningRun } from '@/lib/learning/service'
import { getInstanceUrl } from '@/lib/opencode/client'
import { createConfiguredOpencodeClient } from '@/lib/opencode/client-factory'
import { ensureProviderAccessFreshForExecution } from '@/lib/opencode/providers'
import { getTerminalRetryError } from '@/lib/opencode/retry-state'
import {
  abortSessionFamilyAndConfirmIdle,
  EXECUTION_TERMINATION_UNCONFIRMED_ERROR,
} from '@/lib/opencode/session-execution'
import {
  buildWorkspacePromptParts,
  normalizeContextPaths,
  normalizeMessageAttachments,
  type MessageAttachmentInput,
  type OpenCodePromptPart,
} from '@/lib/opencode/workspace-prompt'
import { isProviderId, normalizeProviderId, resolveRuntimeProviderId } from '@/lib/providers/catalog'
import { recordProviderRunUsageBestEffort } from '@/lib/providers/run-usage'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService, messageRunService } from '@/lib/services'
import { MESSAGE_RUN_TIMEOUT_MS, type ActiveRunRuntimeState } from '@/lib/services/message-run'
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from '@/lib/sse-parser'
import { decryptPassword } from '@/lib/spawner/crypto'
import { getWorkspaceAgentUrl } from '@/lib/workspace-agent/client'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/workspace-attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STREAM_RELEVANT_EVENT_TICK_MS = 1000
const SEND_STREAM_RELEVANT_EVENT_TIMEOUT_MS = 20_000
const RESUME_STREAM_RELEVANT_EVENT_TIMEOUT_MS = 12_000
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 8_000
const SSE_HEARTBEAT_INTERVAL_MS = 10_000
const STATUS_UNKNOWN_GRACE_MS = 45_000
const PROMPT_START_TIMEOUT_MS = 60_000
type StreamRequestBody = {
  attachments: MessageAttachmentInput[]
  contextPaths: string[]
  messageId?: string
  model?: { providerId: string; modelId: string }
  resume: boolean
  runId?: string
  sessionId: string
  text?: string
}

type PromptBody = {
  parts: OpenCodePromptPart[]
  model?: { providerID: string; modelID: string }
}

type StepFinishUsage = {
  costUsd: number
  inputTokens: number
  outputTokens: number
}

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

function getNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readStepFinishUsage(part: unknown): StepFinishUsage | null {
  if (!isRecord(part) || part.type !== 'step-finish') return null

  const tokens = isRecord(part.tokens) ? part.tokens : {}
  return {
    costUsd: getNumber(part.cost),
    inputTokens: getNumber(tokens.input),
    outputTokens: getNumber(tokens.output),
  }
}

function sumStepFinishUsage(usages: Iterable<StepFinishUsage>): StepFinishUsage {
  const total = { costUsd: 0, inputTokens: 0, outputTokens: 0 }
  for (const usage of usages) {
    total.costUsd += usage.costUsd
    total.inputTokens += usage.inputTokens
    total.outputTokens += usage.outputTokens
  }
  return total
}

function hasUsage(usage: StepFinishUsage): boolean {
  return usage.costUsd > 0 || usage.inputTokens > 0 || usage.outputTokens > 0
}

function createSseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function createTerminalRunResponse(status: string, error: string | null): Response {
  if (status === 'succeeded') {
    return createSseResponse([
      { event: 'status', data: { status: 'complete' } },
      { event: 'done', data: { refresh: true } },
    ])
  }

  return createSseResponse([
    {
      event: 'error',
      data: { error: error ?? (status === 'aborted' ? 'cancelled' : 'run_failed') },
    },
  ])
}

function parseStreamRequestBody(body: unknown): StreamRequestBody | null {
  if (!isRecord(body)) return null

  const sessionId = getString(body.sessionId)
  if (!sessionId) return null

  const model = isRecord(body.model)
    ? {
        providerId: getString(body.model.providerId) ?? '',
        modelId: getString(body.model.modelId) ?? '',
      }
    : undefined

  const text = typeof body.text === 'string' && body.text.trim().length > 0
    ? body.text
    : undefined

  return {
    attachments: normalizeMessageAttachments(body.attachments),
    contextPaths: normalizeContextPaths(body.contextPaths),
    messageId: getString(body.messageId),
    model: model?.providerId && model.modelId ? model : undefined,
    resume: body.resume === true,
    runId: getString(body.runId),
    sessionId,
    text,
  }
}

async function readRuntimeSessionState(params: {
  authHeader: string
  baseUrl: string
  sessionId: string
}): Promise<ActiveRunRuntimeState> {
  try {
    const response = await fetch(`${params.baseUrl}/session/status`, {
      headers: {
        Authorization: params.authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!response.ok) return 'unknown'

    const data: unknown = await response.json()
    if (!isRecord(data)) return 'unknown'

    const statusRecord = data[params.sessionId]
    if (!isRecord(statusRecord)) return 'idle'

    const statusType = statusRecord.type
    if (statusType === 'busy' || statusType === 'retry') return 'busy'
    if (statusType === 'idle') return 'idle'

    return 'unknown'
  } catch {
    return 'unknown'
  }
}

async function queueAutoLearningBestEffort(params: {
  authHeader: string
  baseUrl: string
  sessionId: string
  slug: string
  userId: string
}): Promise<void> {
  try {
    if (!(await canQueueAutoLearningRun({ userId: params.userId, sessionId: params.sessionId }))) return

    // Fetch only enough messages to know whether the threshold is met; the full
    // list can be large and this helper runs after every successful completion.
    const messagesResponse = await fetch(
      `${params.baseUrl}/session/${params.sessionId}/message?limit=${AUTO_LEARNING_MIN_MESSAGES}`,
      {
        headers: { Authorization: params.authHeader, Accept: 'application/json' },
        cache: 'no-store',
      },
    )
    const messagesData: unknown = await messagesResponse.json().catch(() => null)
    const messageCount = Array.isArray(messagesData) ? messagesData.length : 0
    if (messageCount < AUTO_LEARNING_MIN_MESSAGES) return

    const sessionResponse = await fetch(`${params.baseUrl}/session/${params.sessionId}`, {
      headers: { Authorization: params.authHeader, Accept: 'application/json' },
      cache: 'no-store',
    })
    const sessionData: unknown = await sessionResponse.json().catch(() => null)
    const sessionTitle = isRecord(sessionData) && typeof sessionData.title === 'string'
      ? sessionData.title
      : 'Session'

    const queuedRun = await maybeQueueAutoLearningRun({
      userId: params.userId,
      slug: params.slug,
      sessionId: params.sessionId,
      sessionTitle,
      messageCount,
    })
    if (queuedRun) {
      dispatchLearningRunExecution({
        runId: queuedRun.id,
        slug: params.slug,
        userId: params.userId,
        sourceSessionId: queuedRun.sourceSessionId,
        title: queuedRun.title,
        trigger: 'auto',
      })
    }
  } catch {
    // Auto-learning is best-effort and must not affect chat streaming.
  }
}

/**
 * SSE streaming endpoint for chat messages.
 *
 * Events emitted to client:
 * - status: { status: 'connecting' | 'thinking' | 'reasoning' | 'tool-calling' | 'writing' | 'complete' | 'error', toolName?, detail? }
 * - message: { id, role, sessionId }
 * - part: { messageId, part, delta? }
 * - workspace-updated: { type, path? }
 * - done: { refresh: true } - Stream complete, client should refresh messages
 * - error: { error: string }
 */
export const POST = withAuth(
  { csrf: true },
  async (request: NextRequest, { slug, user }) => {
    // Get instance credentials
    const instance = await instanceService.findCredentialsBySlug(slug)

    if (!instance || !instance.serverPassword || instance.status !== 'running') {
      return jsonErrorResponse(503, 'instance_unavailable')
    }

    // Parse request body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonErrorResponse(400, 'invalid_json')
    }

    const streamBody = parseStreamRequestBody(body)
    if (!streamBody) {
      return jsonErrorResponse(400, 'missing_fields')
    }

    const {
      attachments,
      contextPaths,
      messageId,
      model,
      resume,
      runId,
      sessionId,
      text,
    } = streamBody
    const startsPrompt = !resume && !runId
    const hasPromptInput = Boolean(text) || attachments.length > 0 || contextPaths.length > 0 || Boolean(model)
    const observationId = randomUUID()

    if (!startsPrompt && hasPromptInput) {
      return jsonErrorResponse(400, 'invalid_stream_payload')
    }

    if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      return jsonErrorResponse(400, 'too_many_attachments')
    }

    if (startsPrompt && !text && attachments.length === 0) {
      return jsonErrorResponse(400, 'missing_fields')
    }

    const password = decryptPassword(instance.serverPassword)
    const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    const baseUrl = getInstanceUrl(slug)
    const workspaceAgentUrl = getWorkspaceAgentUrl(slug)

    let activeRunId = runId ?? null
    let runStartedAt = Date.now()
    let promptBody: PromptBody | null = null

    if (runId) {
      const run = await messageRunService.findRunById(runId)
      if (!run || run.slug !== slug || run.sessionId !== sessionId) {
        return jsonErrorResponse(404, 'run_not_found')
      }
      if (run.status !== 'running') {
        return createTerminalRunResponse(run.status, run.error)
      }
      runStartedAt = run.startedAt.getTime()
    }

    if (!activeRunId && resume) {
      const activeRun = await messageRunService.findActiveRun(slug, sessionId)
      if (activeRun?.status === 'running') {
        activeRunId = activeRun.id
        runStartedAt = activeRun.startedAt.getTime()
      }
    }

    if (startsPrompt) {
      const runResult = await messageRunService.createActiveRunAfterRuntimeStateCheck({
        readRuntimeSessionState: () => readRuntimeSessionState({
          authHeader,
          baseUrl,
          sessionId,
        }),
        sessionId,
        slug,
        source: 'web',
      })

      if (!runResult.ok) {
        return NextResponse.json(
          {
            error: 'session_busy',
            activeRun: runResult.activeRun
              ? {
                  runId: runResult.activeRun.id,
                  sessionId: runResult.activeRun.sessionId,
                  source: runResult.activeRun.source,
                  status: runResult.activeRun.status,
                  startedAt: runResult.activeRun.startedAt.toISOString(),
                }
              : null,
          },
          { status: 409 },
        )
      }

      activeRunId = runResult.run.id
      runStartedAt = runResult.run.startedAt.getTime()

      const prompt = await buildWorkspacePromptParts({
        agent: { baseUrl: workspaceAgentUrl, authHeader },
        attachments,
        contextPaths,
        text,
      })
      if (!prompt.ok) {
        await messageRunService.markRunFailed(activeRunId, prompt.error).catch(() => undefined)
        return jsonErrorResponse(400, prompt.error)
      }

      promptBody = {
        parts: prompt.parts,
        ...(model && {
          model: {
            providerID: resolveRuntimeProviderId(model.providerId),
            modelID: model.modelId,
          },
        }),
      }

      try {
        await ensureProviderAccessFreshForExecution({ slug, userId: user.id, ignoreActiveRunId: activeRunId })
      } catch (error) {
        await messageRunService.markRunFailed(
          activeRunId,
          error instanceof Error ? error.message : 'provider_sync_failed',
        ).catch(() => undefined)
        return jsonErrorResponse(503, 'provider_sync_failed')
      }
    }

    // Create SSE stream
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        // Track whether the downstream client (browser) has disconnected.
        let clientGone = false
        let aborted = false
        let firstDownstreamEventSeen = false
        let firstUpstreamEventSeen = false
        let terminalReason: string | null = null
        let heartbeatCount = 0
        const upstreamEventsController = new AbortController()

        // Shared reference so the abort path and finally block can always
        // clean up the active reader when it exists.
        let eventReader: ReadableStreamDefaultReader<Uint8Array> | null = null
        let promptStarted = !startsPrompt

        const logObservation = (event: string, details: Record<string, unknown> = {}) => {
          console.log('[chat/stream]', {
            activeRunId,
            event,
            observationId,
            sessionId,
            slug,
            ...details,
          })
        }

        const recordTerminalReason = (reason: string, details: Record<string, unknown> = {}) => {
          if (terminalReason) return
          terminalReason = reason
          logObservation('stream_terminal', { reason, ...details })
        }

        const handleAbort = () => {
          clientGone = true
          aborted = true
          recordTerminalReason('client_abort')
          logObservation('client_abort')
          upstreamEventsController.abort()
          void eventReader?.cancel().catch(() => undefined)
          if (startsPrompt && activeRunId && !promptStarted) {
            void messageRunService.markRunAborted(activeRunId).catch(() => undefined)
          }
          try { controller.close() } catch { /* already closed/errored */ }
        }

        if (request.signal.aborted) {
          handleAbort()
        } else {
          request.signal.addEventListener('abort', handleAbort, { once: true })
        }

        const sendEvent = (event: string, data: unknown) => {
          if (clientGone) return
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            if (!firstDownstreamEventSeen) {
              firstDownstreamEventSeen = true
              logObservation('first_downstream_event', { eventType: event })
            }
          } catch {
            clientGone = true
            aborted = true
            recordTerminalReason('downstream_write_error')
            upstreamEventsController.abort()
            void eventReader?.cancel().catch(() => undefined)
          }
        }

        const sendHeartbeat = () => {
          if (clientGone || aborted) return
          try {
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
            heartbeatCount += 1
            logObservation('heartbeat', { count: heartbeatCount })
          } catch {
            clientGone = true
            aborted = true
            recordTerminalReason('downstream_write_error')
            upstreamEventsController.abort()
            void eventReader?.cancel().catch(() => undefined)
          }
        }

        const heartbeatInterval = setInterval(sendHeartbeat, SSE_HEARTBEAT_INTERVAL_MS)
        logObservation('downstream_open')

        const markRunSucceeded = () => {
          if (!activeRunId) return
          void messageRunService.markRunSucceeded(activeRunId).catch(() => undefined)
        }

        const markRunFailed = (detail: string) => {
          if (!activeRunId) return
          void messageRunService.markRunFailed(activeRunId, detail).catch(() => undefined)
        }

        const closeForObservationInterruption = (detail: string, reason = detail) => {
          sendEvent('error', {
            error: detail,
            recoverable: true,
            ...(activeRunId ? { runId: activeRunId } : {}),
          })
          recordTerminalReason(reason, { detail, recoverable: true })
          aborted = true
        }

        const failEventSubscription = (detail: string) => {
          if (startsPrompt) {
            markRunFailed(detail)
            sendEvent('error', { error: detail })
            recordTerminalReason(detail, { recoverable: false })
            aborted = true
            return
          }

          closeForObservationInterruption(detail)
        }

        try {
          sendEvent('status', { status: 'connecting' })
          let terminalRetryError: string | null = null
          const readUpstreamSessionStatus = createUpstreamSessionStatusReader({
            baseUrl,
            authHeader,
            sessionId,
            onRead: ({ durationMs, outcome, responseStatus, status, terminalError }) => {
              if (terminalError) {
                terminalRetryError = terminalError
              }
              logObservation('upstream_status_read', {
                durationMs,
                outcome,
                responseStatus,
                status,
              })
            },
          })

          // Subscribe first so we don't miss fast session events.
          const eventsUrl = `${baseUrl}/event`

          let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
          if (!clientGone) {
            const connectStartedAt = Date.now()
            let connectTimedOut = false
            const connectTimeout = setTimeout(() => {
              connectTimedOut = true
              upstreamEventsController.abort()
            }, EVENT_STREAM_CONNECT_TIMEOUT_MS)
            logObservation('upstream_connect_start')
            try {
              const eventsResponse = await fetch(eventsUrl, {
                method: 'GET',
                headers: {
                  'Authorization': authHeader,
                  'Accept': 'text/event-stream',
                  'Cache-Control': 'no-cache'
                },
                signal: upstreamEventsController.signal,
              })

              if (!eventsResponse.ok || !eventsResponse.body) {
                logObservation('upstream_connect_failure', {
                  durationMs: Date.now() - connectStartedAt,
                  reason: 'event_stream_unavailable',
                  responseStatus: eventsResponse.status,
                })
                failEventSubscription('event_stream_unavailable')
                return
              }

              logObservation('upstream_connect_success', {
                durationMs: Date.now() - connectStartedAt,
              })
              reader = eventsResponse.body.getReader()
              eventReader = reader
            } catch (error) {
              if (!clientGone) {
                const detail = connectTimedOut
                  ? 'event_stream_connect_timeout'
                  : 'event_stream_unavailable'
                logObservation('upstream_connect_failure', {
                  durationMs: Date.now() - connectStartedAt,
                  error: error instanceof Error ? error.message : String(error),
                  reason: detail,
                })
                failEventSubscription(detail)
              }
              return
            } finally {
              clearTimeout(connectTimeout)
            }
          }

        const decoder = new TextDecoder()
        let parseState = INITIAL_SSE_PARSE_STATE

        sendEvent('status', { status: 'thinking' })

        if (!reader || clientGone || aborted) {
          return
        }

        const cancelReader = async () => {
          await reader.cancel().catch(() => undefined)
        }

        if (startsPrompt) {
          const promptStartSignal = AbortSignal.timeout(PROMPT_START_TIMEOUT_MS)
          let promptResponse: Response
          try {
            // Once OpenCode receives the prompt it may keep running after navigation;
            // keep the run resumable instead of marking it aborted on disconnect.
            promptStarted = true
            promptResponse = await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
              },
              body: JSON.stringify(promptBody),
              signal: promptStartSignal,
            })
          } catch (error) {
            const detail =
              isTimeoutError(error) || (promptStartSignal.aborted && isAbortError(error))
                ? 'prompt_start_timeout'
                : error instanceof Error
                  ? error.message
                  : 'prompt_start_failed'
            markRunFailed(detail)
            sendEvent('error', { error: detail })
            recordTerminalReason(
              detail === 'prompt_start_timeout' ? detail : 'prompt_start_failed',
            )
            await cancelReader()
            return
          }

          if (!promptResponse.ok) {
            const errorText = await promptResponse.text()
            const detail = `Failed to start message: ${errorText}`
            markRunFailed(detail)
            sendEvent('error', { error: detail })
            recordTerminalReason('prompt_start_rejected', { responseStatus: promptResponse.status })
            await cancelReader()
            return
          }

          logObservation('prompt_accepted')
        }

        // Track state for the assistant response
        let currentStatus: string | null = null
        let currentToolName: string | undefined
        let currentDetail: string | undefined
        let assistantMessageId: string | null = messageId ?? null
        const messageRoles = new Map<string, string>()
        const partTypes = new Map<string, string>()
        const seenPartMessageIds = new Set<string>()
        const pendingPermissionIds = new Set<string>()
        let assistantMessageSeen = typeof assistantMessageId === 'string'
        let assistantPartSeen = false
        let runProviderId = model?.providerId && isProviderId(model.providerId) ? model.providerId : null
        let runModelId = model?.modelId ?? null
        let lastRelevantEventAt = Date.now()
        let lastStreamActivityAt = lastRelevantEventAt
        let unknownStatusSince: number | null = null
        const stepFinishUsageByPart = new Map<string, StepFinishUsage>()
        const relevantEventTimeoutMs = resume
          ? RESUME_STREAM_RELEVANT_EVENT_TIMEOUT_MS
          : SEND_STREAM_RELEVANT_EVENT_TIMEOUT_MS

        if (resume) {
          try {
            const client = await createConfiguredOpencodeClient({ authHeader, baseUrl })
            const result = await client.permission.list()
            const permissions = Array.isArray(result.data) ? result.data : []
            for (const permission of permissions) {
              if (!isRecord(permission) || getString(permission.sessionID) !== sessionId) continue

              const permissionId = getString(permission.id)
              if (permissionId) pendingPermissionIds.add(permissionId)
            }
          } catch (error) {
            console.warn('[chat/stream] Failed to list pending resume permissions', { error, sessionId })
          }
        }

        const markRelevantEvent = () => {
          const now = Date.now()
          lastRelevantEventAt = now
          lastStreamActivityAt = now
        }

        const markWatchdogCheck = () => {
          lastRelevantEventAt = Date.now()
        }

        const emitStatus = (status: string, toolName?: string, detail?: string) => {
          if (currentStatus === status && currentToolName === toolName && currentDetail === detail) return
          currentStatus = status
          currentToolName = toolName
          currentDetail = detail
          sendEvent('status', { status, toolName, detail })
        }

        const failForTerminalRetry = (detail: string) => {
          emitStatus('error', undefined, detail)
          sendEvent('error', { error: detail })
          recordRunUsage()
          markRunFailed(detail)
          recordTerminalReason('terminal_retry', { detail })
          aborted = true
        }

        const getPartKey = (partMessageId: string, partId: unknown) =>
          typeof partId === 'string' && partId.trim().length > 0
            ? `${partMessageId}:${partId}`
            : null

        const recordRunUsage = () => {
          if (!activeRunId || !runProviderId) return

          const usage = sumStepFinishUsage(stepFinishUsageByPart.values())
          if (!hasUsage(usage)) return

          const messageRunId = activeRunId
          const providerId = runProviderId
          recordProviderRunUsageBestEffort({
            costUsd: usage.costUsd,
            inputTokens: usage.inputTokens,
            messageRunId,
            modelId: runModelId,
            outputTokens: usage.outputTokens,
            providerId,
            source: 'web',
            userId: user.id,
          }, '[chat/stream]')
        }

        const abortRuntimeSession = async (): Promise<boolean> => {
          try {
            const client = await createConfiguredOpencodeClient({ authHeader, baseUrl })
            const terminated = await abortSessionFamilyAndConfirmIdle({
              client,
              rootSessionId: sessionId,
            })
            if (!terminated) {
              console.warn('[chat/stream] Timed out session could not be confirmed idle', { sessionId })
            }
            return terminated
          } catch {
            console.warn('[chat/stream] Timed out session termination failed', { sessionId })
            return false
          }
        }

        const finalizeFromIdle = () => {
          if (aborted) return

          if (pendingPermissionIds.size > 0) {
            markWatchdogCheck()
            return
          }

          const outcome = getIdleFinalizationOutcome({
            resume: Boolean(resume),
            assistantMessageSeen,
            assistantPartSeen,
          })

          if (outcome !== 'complete') {
            emitStatus('error', undefined, outcome)
            sendEvent('error', { error: outcome })
            recordRunUsage()
            markRunFailed(outcome)
            recordTerminalReason(`idle_${outcome}`)
            aborted = true
            return
          }

          emitStatus('complete')
          sendEvent('done', { refresh: true })
          recordRunUsage()
          markRunSucceeded()
          recordTerminalReason('idle_confirmed_complete')
          void queueAutoLearningBestEffort({ authHeader, baseUrl, sessionId, slug, userId: user.id })
          aborted = true
        }

        while (!aborted) {
          const readPromise = reader.read()
          let streamReadResult: ReadableStreamReadResult<Uint8Array> | null = null

          while (!aborted && !streamReadResult) {
            let tickTimer: ReturnType<typeof setTimeout> | undefined
            const readResult = await Promise.race([
              readPromise.then((result) => ({ type: 'data' as const, result })),
              new Promise<{ type: 'tick' }>((resolve) => {
                tickTimer = setTimeout(() => resolve({ type: 'tick' }), STREAM_RELEVANT_EVENT_TICK_MS)
              }),
            ])
            if (readResult.type !== 'tick') clearTimeout(tickTimer)

            if (readResult.type === 'tick') {
              if (Date.now() - lastRelevantEventAt > relevantEventTimeoutMs) {
                if (pendingPermissionIds.size > 0) {
                  markWatchdogCheck()
                  continue
                }

                const upstreamStatus = await readUpstreamSessionStatus()
                if (terminalRetryError) {
                  failForTerminalRetry(terminalRetryError)
                  continue
                }
                const statusReadAt = Date.now()
                if (upstreamStatus === 'busy' || upstreamStatus === 'retry' || upstreamStatus === 'idle') {
                  unknownStatusSince = null
                } else if (unknownStatusSince === null) {
                  unknownStatusSince = statusReadAt
                }

                const watchdogOutcome = getSilentStreamOutcome(
                  {
                    maxRuntimeMs: MESSAGE_RUN_TIMEOUT_MS,
                    runtimeMs: statusReadAt - runStartedAt,
                    upstreamStatus,
                    silentForMs: statusReadAt - lastStreamActivityAt,
                    relevantEventTimeoutMs,
                    unknownStatusForMs: unknownStatusSince === null
                      ? 0
                      : statusReadAt - unknownStatusSince,
                    unknownStatusGraceMs: STATUS_UNKNOWN_GRACE_MS,
                  },
                )

                if (watchdogOutcome === 'keep_waiting') {
                  markWatchdogCheck()
                  continue
                }

                if (watchdogOutcome === 'finalize_idle') {
                  markWatchdogCheck()
                  finalizeFromIdle()
                  continue
                }

                if (watchdogOutcome === 'status_unknown_timeout') {
                  recordRunUsage()
                  closeForObservationInterruption(
                    'stream_status_unavailable',
                    'status_unknown_grace_exhausted',
                  )
                  continue
                }

                recordRunUsage()
                const terminated = await abortRuntimeSession()
                const failure = terminated
                  ? 'stream_timeout'
                  : EXECUTION_TERMINATION_UNCONFIRMED_ERROR
                emitStatus('error', undefined, failure)
                sendEvent('error', terminated ? { error: failure } : {
                  cause: 'stream_timeout',
                  error: failure,
                })
                if (terminated) {
                  markRunFailed(failure)
                }
                recordTerminalReason('max_runtime_exceeded', {
                  executionTerminationConfirmed: terminated,
                })
                aborted = true
              }
              continue
            }

            streamReadResult = readResult.result
          }

          if (aborted || !streamReadResult) {
            break
          }

          const { done, value } = streamReadResult
          if (done || !value) {
            logObservation('upstream_eof')
            const upstreamStatus = await readUpstreamSessionStatus()
            if (terminalRetryError) {
              failForTerminalRetry(terminalRetryError)
            } else if (!aborted && upstreamStatus === 'idle') {
              finalizeFromIdle()
            } else if (!aborted) {
              closeForObservationInterruption('upstream_eof')
            }
            break
          }

          const parsed = parseSseChunk(parseState, decoder.decode(value, { stream: true }))
          parseState = parsed.state

          for (const parsedEvent of parsed.events) {
            if (aborted) {
              break
            }

            const eventData = parsedEvent.data
            if (!eventData) continue

            // End of event, process it
              try {
                const event = JSON.parse(eventData)

                // Get sessionID from event
                const eventSessionId =
                  event.properties?.permission?.sessionID ||
                  event.properties?.sessionID ||
                  event.properties?.info?.sessionID ||
                  event.properties?.part?.sessionID

                const eventType = typeof event.type === 'string' ? event.type : ''
                if (!firstUpstreamEventSeen) {
                  firstUpstreamEventSeen = true
                  logObservation('first_upstream_event', { eventType })
                }
                const isWorkspaceEvent =
                  eventType === 'file.edited' ||
                  eventType === 'file.created' ||
                  eventType === 'file.deleted' ||
                  eventType === 'todo.updated'

                const isSessionScopedEvent =
                  eventType === 'session.status' ||
                  eventType === 'session.idle' ||
                  eventType === 'session.error' ||
                  eventType === 'permission.updated' ||
                  eventType === 'permission.replied'

                // Filter events for our session only
                if (!isWorkspaceEvent) {
                  if (isSessionScopedEvent && eventSessionId !== sessionId) {
                    continue
                  }

                  if (!isSessionScopedEvent && eventSessionId && eventSessionId !== sessionId) {
                    continue
                  }
                }

                switch (eventType) {
                  // Session status changes
                  case 'session.status': {
                    markRelevantEvent()
                    const status = event.properties?.status

                    const terminalError = getTerminalRetryError(status)
                    if (terminalError) {
                      failForTerminalRetry(terminalError)
                    } else if (status?.type === 'busy') {
                      emitStatus('thinking')
                    } else if (status?.type === 'retry') {
                      emitStatus('thinking', undefined, status?.message)
                    } else if (status?.type === 'idle') {
                      if (pendingPermissionIds.size > 0) {
                        break
                      }
                      finalizeFromIdle()
                    }
                    break
                  }

                  case 'session.idle': {
                    markRelevantEvent()
                    if (pendingPermissionIds.size > 0) {
                      break
                    }
                    finalizeFromIdle()
                    break
                  }

                  case 'session.error': {
                    markRelevantEvent()
                    const error = event.properties?.error
                    const errorMessage = error?.data?.message || 'Unknown error'

                    emitStatus('error', undefined, errorMessage)
                    sendEvent('error', { error: errorMessage })
                    recordRunUsage()
                    markRunFailed(errorMessage)
                    recordTerminalReason('upstream_session_error')
                    aborted = true
                    break
                  }

                  case 'permission.updated': {
                    markRelevantEvent()

                    const permission = isRecord(event.properties?.permission)
                      ? event.properties.permission
                      : isRecord(event.properties?.info)
                        ? event.properties.info
                        : isRecord(event.properties)
                          ? event.properties
                          : null
                    const permissionId =
                      getString(permission?.id) ??
                      getString(event.properties?.permissionID) ??
                      getString(event.properties?.permissionId)

                    if (!permissionId) break

                    pendingPermissionIds.add(permissionId)

                    const metadata = isRecord(permission?.metadata)
                      ? permission.metadata
                      : undefined
                    const permissionMessageId =
                      getString(permission?.messageID) ??
                      getString(permission?.messageId) ??
                      assistantMessageId ??
                      undefined
                    const toolName =
                      getString(metadata?.tool) ??
                      getString(metadata?.toolName) ??
                      getString(permission?.pattern)

                    emitStatus('tool-calling', toolName, 'permission_required')
                    sendEvent('permission', {
                      id: permissionId,
                      sessionId: getString(permission?.sessionID) ?? eventSessionId ?? sessionId,
                      messageId: permissionMessageId,
                      callId: getString(permission?.callID) ?? getString(permission?.callId),
                      type: getString(permission?.type),
                      pattern: getString(permission?.pattern),
                      title: getString(permission?.title) ?? getString(permission?.pattern) ?? 'Tool approval required',
                      metadata,
                      state: 'pending',
                    })
                    break
                  }

                  case 'permission.replied': {
                    markRelevantEvent()

                    const permission = isRecord(event.properties?.permission)
                      ? event.properties.permission
                      : isRecord(event.properties?.info)
                        ? event.properties.info
                        : isRecord(event.properties)
                          ? event.properties
                          : null
                    const permissionId =
                      getString(permission?.id) ??
                      getString(event.properties?.permissionID) ??
                      getString(event.properties?.permissionId)

                    if (!permissionId) break

                    pendingPermissionIds.delete(permissionId)
                    sendEvent('permission-replied', {
                      id: permissionId,
                      sessionId: getString(permission?.sessionID) ?? eventSessionId ?? sessionId,
                      response: getString(event.properties?.response) ?? getString(permission?.response),
                    })
                    break
                  }

                  case 'message.updated': {
                    markRelevantEvent()
                    const info = event.properties?.info
                    if (!info) break
                    messageRoles.set(info.id, info.role)
                    sendEvent('message', { id: info.id, role: info.role, sessionId: info.sessionID })
                    if (info.role === 'assistant' && !assistantMessageId) {
                      assistantMessageId = info.id
                    }
                    if (info.role === 'assistant') {
                      assistantMessageSeen = true
                      if (seenPartMessageIds.has(info.id)) {
                        assistantPartSeen = true
                      }
                      sendEvent('assistant-meta', {
                        providerID:
                          typeof info.providerID === 'string'
                            ? normalizeProviderId(info.providerID)
                            : info.providerID,
                        modelID: info.modelID,
                        agent: info.agent
                      })
                      if (typeof info.providerID === 'string') {
                        const normalizedProviderId = normalizeProviderId(info.providerID)
                        if (isProviderId(normalizedProviderId)) {
                          runProviderId = normalizedProviderId
                        }
                      }
                      if (typeof info.modelID === 'string' && info.modelID.trim()) {
                        runModelId = info.modelID.trim()
                      }
                    }
                    break
                  }

                  // Message part updates
                  case 'message.part.updated': {
                    markRelevantEvent()
                    const part = event.properties?.part
                    const delta = event.properties?.delta
                    if (!part) break

                    const partMessageId = part.messageID
                    if (typeof partMessageId !== 'string') break
                    seenPartMessageIds.add(partMessageId)
                    const partKey = getPartKey(partMessageId, part.id)
                    if (partKey && typeof part.type === 'string') {
                      partTypes.set(partKey, part.type)
                    }
                    const knownRole = messageRoles.get(partMessageId)
                    if (!assistantMessageId && knownRole === 'assistant') {
                      assistantMessageId = partMessageId
                      assistantMessageSeen = true
                    }

                    const isAssistantPart = assistantMessageId
                      ? partMessageId === assistantMessageId
                      : knownRole === 'assistant'

                    sendEvent('part', { messageId: partMessageId, part, delta })

                    if (!isAssistantPart) break

                    assistantPartSeen = true

                    switch (part.type) {
                      case 'text': {
                        emitStatus('writing')
                        break
                      }

                      case 'reasoning': {
                        emitStatus('reasoning')
                        break
                      }

                      case 'tool': {
                        const state = part.state
                        const toolName = part.tool || 'unknown'

                        if (state?.status === 'pending' || state?.status === 'running') {
                          emitStatus('tool-calling', toolName, state.title)
                        } else if (state?.status === 'error') {
                          emitStatus('error', toolName, state.error)
                        } else {
                          emitStatus('thinking')
                        }
                        break
                      }

                      case 'step-start': {
                        emitStatus('thinking')
                        break
                      }

                      case 'step-finish': {
                        const stepUsage = readStepFinishUsage(part)
                        if (partKey && stepUsage) {
                          stepFinishUsageByPart.set(partKey, stepUsage)
                        }
                        emitStatus('thinking')
                        break
                      }

                      case 'retry': {
                        emitStatus('thinking')
                        break
                      }

                      case 'agent': {
                        sendEvent('agent', { agent: part.name })
                        break
                      }

                      case 'subtask': {
                        sendEvent('agent', { agent: part.agent })
                        break
                      }
                    }
                    break
                  }

                  case 'message.part.delta': {
                    markRelevantEvent()

                    const properties =
                      event.properties && typeof event.properties === 'object'
                        ? event.properties as Record<string, unknown>
                        : null
                    const rawPart =
                      properties?.part && typeof properties.part === 'object'
                        ? properties.part as Record<string, unknown>
                        : null
                    const delta = properties?.delta ?? rawPart?.delta ?? properties?.text ?? properties?.value
                    const partMessageId =
                      typeof rawPart?.messageID === 'string'
                        ? rawPart.messageID
                        : typeof properties?.messageID === 'string'
                          ? properties.messageID
                          : typeof assistantMessageId === 'string'
                            ? assistantMessageId
                            : null

                    if (!partMessageId) break
                    seenPartMessageIds.add(partMessageId)

                    const knownRole = messageRoles.get(partMessageId)
                    if (!assistantMessageId && knownRole === 'assistant') {
                      assistantMessageId = partMessageId
                      assistantMessageSeen = true
                    }

                    const isAssistantPart = assistantMessageId
                      ? partMessageId === assistantMessageId
                      : knownRole === 'assistant'

                    const part: Record<string, unknown> = rawPart ? { ...rawPart } : {}
                    if (typeof part.id !== 'string') {
                      if (typeof properties?.partID === 'string') {
                        part.id = properties.partID
                      } else if (typeof properties?.id === 'string') {
                        part.id = properties.id
                      }
                    }

                    const partKey = getPartKey(partMessageId, part.id)
                    const partType =
                      typeof part.type === 'string'
                        ? part.type
                        : typeof properties?.partType === 'string'
                          ? properties.partType
                          : partKey
                            ? partTypes.get(partKey)
                            : undefined

                    if (typeof partType === 'string') {
                      part.type = partType
                      if (partKey) {
                        partTypes.set(partKey, partType)
                      }
                    }
                    if (typeof part.messageID !== 'string') {
                      part.messageID = partMessageId
                    }
                    if (typeof part.sessionID !== 'string' && typeof eventSessionId === 'string') {
                      part.sessionID = eventSessionId
                    }

                    if (typeof part.type === 'string') {
                      sendEvent('part', { messageId: partMessageId, part, delta })
                    }

                    if (!isAssistantPart) break

                    assistantPartSeen = true

                    if (part.type === 'reasoning') {
                      emitStatus('reasoning')
                    } else if (part.type === 'text') {
                      emitStatus('writing')
                    } else {
                      emitStatus('thinking')
                    }
                    break
                  }

                  case 'file.edited':
                  case 'file.created':
                  case 'file.deleted':
                  case 'todo.updated': {
                    const maybePath =
                      event.properties?.path ||
                      event.properties?.file?.path ||
                      event.properties?.part?.path

                    sendEvent('workspace-updated', {
                      type: eventType,
                      path: typeof maybePath === 'string' ? maybePath : undefined,
                    })
                    break
                  }

                  // Ignore other event types
                  case 'session.updated':
                  case 'session.created':
                    // These are informational, don't need to forward
                    break

                  default:
                    break
                }
              } catch {
                // Ignore malformed upstream event payloads.
              }
          }
        }

        reader.releaseLock()

      } catch (error) {
        if (!aborted && !request.signal.aborted && !isAbortError(error)) {
          logObservation('upstream_error', {
            error: error instanceof Error ? error.message : String(error),
          })
          closeForObservationInterruption('upstream_stream_error')
        }
      } finally {
        clearInterval(heartbeatInterval)
        request.signal.removeEventListener('abort', handleAbort)
        upstreamEventsController.abort()
        if (eventReader) {
          await eventReader.cancel().catch(() => undefined)
        }
        recordTerminalReason('stream_closed')
        try { controller.close() } catch { /* already closed/errored */ }
      }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...(activeRunId ? { 'X-Arche-Run-Id': activeRunId } : {}),
      }
    })
  },
)
