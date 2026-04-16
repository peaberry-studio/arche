import { NextRequest, NextResponse } from 'next/server'

import { getIdleFinalizationOutcome, getSilentStreamOutcome } from '@/app/api/w/[slug]/chat/stream/watchdog'
import { createUpstreamSessionStatusReader } from '@/app/api/w/[slug]/chat/stream/status-reader'
import { extractPdfText, isPdfMime } from '@/lib/attachments/pdf-text-extractor'
import { getInstanceUrl } from '@/lib/opencode/client'
import { normalizeProviderId, resolveRuntimeProviderId } from '@/lib/providers/catalog'
import { isDesktop } from '@/lib/runtime/mode'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService } from '@/lib/services'
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from '@/lib/sse-parser'
import { decryptPassword } from '@/lib/spawner/crypto'
import {
  isValidContextReferencePath,
  normalizeAttachmentPath,
  normalizeWorkspacePath,
} from '@/lib/workspace-paths'
import { workspaceAgentFetch } from '@/lib/workspace-agent-client'
import { getWorkspaceAgentUrl } from '@/lib/workspace-agent/client'
import {
  inferAttachmentMimeType,
  isDocumentMimeType,
  isPresentationMimeType,
  isWorkspaceAttachmentPath,
  isSpreadsheetMimeType,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@/lib/workspace-attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MessageAttachmentInput = {
  path: string
  filename?: string
  mime?: string
}

type WorkspaceAgentReadResponse = {
  ok: boolean
  content?: string
  encoding?: 'utf-8' | 'base64'
  error?: string
}

const MAX_PDF_BYTES_FOR_EXTRACTION = 8 * 1024 * 1024
const MAX_IMAGE_BYTES_FOR_INLINE = 8 * 1024 * 1024
const MAX_PDF_TEXT_CHARS = 24_000
const MAX_CONTEXT_REFERENCES_PER_MESSAGE = 20
const STREAM_RELEVANT_EVENT_TICK_MS = 1000
const SEND_STREAM_RELEVANT_EVENT_TIMEOUT_MS = 20_000
const RESUME_STREAM_RELEVANT_EVENT_TIMEOUT_MS = 12_000

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function normalizeContextPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const unique = new Set<string>()
  const normalized: string[] = []

  for (const item of value) {
    if (typeof item !== 'string') continue
    const path = normalizeWorkspacePath(item.trim())
    if (!isValidContextReferencePath(path) || unique.has(path)) continue

    unique.add(path)
    normalized.push(path)

    if (normalized.length >= MAX_CONTEXT_REFERENCES_PER_MESSAGE) {
      break
    }
  }

  return normalized
}

function toContextReferenceText(paths: string[]): string {
  return [
    'Workspace context references (open files):',
    ...paths.map((path) => `@${path}`),
    'These are references only; inspect files with tools when needed.',
  ].join('\n')
}

function normalizeMessageAttachments(
  value: unknown,
): MessageAttachmentInput[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      path: typeof item.path === 'string' ? normalizeAttachmentPath(item.path) : '',
      filename: typeof item.filename === 'string' ? item.filename : undefined,
      mime: typeof item.mime === 'string' ? item.mime : undefined,
    }))
    .filter((item) => item.path.length > 0)
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

function isImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime.toLowerCase())
}

async function readWorkspaceImageAttachment(
  agent: { baseUrl: string; authHeader: string },
  path: string,
): Promise<Buffer | null> {
  const response = await workspaceAgentFetch<WorkspaceAgentReadResponse>(agent, '/files/read', {
    path,
  })
  if (!response.ok) return null

  const decoded = decodeWorkspaceAgentFileContent(response.data)
  if (!decoded || decoded.length === 0) return null
  if (decoded.length > MAX_IMAGE_BYTES_FOR_INLINE) return null
  return decoded
}

function toWorkspaceFileUrl(path: string): string | null {
  if (isDesktop()) {
    return null
  }

  const encodedPath = normalizeAttachmentPath(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `file:///workspace/${encodedPath}`
}

function toAttachmentPromptPath(path: string): string {
  const normalized = normalizeAttachmentPath(path)
  return isDesktop() ? normalized : `/workspace/${normalized}`
}

function toAttachmentHintText(paths: string[]): string {
  const lines = [
    'Attached workspace files:',
    ...paths.map((path) => `- ${toAttachmentPromptPath(path)}`),
    'If direct file parsing is unavailable, inspect these paths with available tools.',
  ]
  return lines.join('\n')
}

function toPdfExtractedTextPart(path: string, text: string, truncated: boolean): string {
  const truncationNote = truncated
    ? '\n\n[The extracted content was truncated to fit the prompt window.]'
    : ''

  return [
    `Extracted text from attached PDF: ${toAttachmentPromptPath(path)}`,
    text,
    truncationNote,
  ]
    .filter((segment) => segment.length > 0)
    .join('\n\n')
}

function toPdfExtractionFailureText(path: string): string {
  return [
    `Attached PDF could not be extracted automatically: ${toAttachmentPromptPath(path)}`,
    'Continue by using available tools on this path, or ask the user for an OCR-friendly/text PDF if the file is scanned.',
  ].join('\n')
}

function toSpreadsheetToolHintText(path: string): string {
  return [
    `Attached spreadsheet file: ${toAttachmentPromptPath(path)}`,
    'You must use spreadsheet_inspect first to detect sheets and columns, then use spreadsheet_sample/spreadsheet_query/spreadsheet_stats for focused analysis and calculations.',
  ].join('\n')
}

function toDocumentToolHintText(path: string): string {
  return [
    `Attached document file: ${toAttachmentPromptPath(path)}`,
    'Use document_inspect to extract the structure, headings, and normalized text before answering detailed questions about the document.',
  ].join('\n')
}

function toPresentationToolHintText(path: string): string {
  return [
    `Attached presentation file: ${toAttachmentPromptPath(path)}`,
    'Use presentation_inspect to inspect slide structure and extracted slide text before summarizing or comparing the deck.',
  ].join('\n')
}

function decodeWorkspaceAgentFileContent(data: WorkspaceAgentReadResponse): Buffer | null {
  if (typeof data.content !== 'string') return null

  if (data.encoding === 'base64') {
    try {
      return Buffer.from(data.content, 'base64')
    } catch {
      return null
    }
  }

  if (data.encoding === 'utf-8' || data.encoding === undefined) {
    return Buffer.from(data.content, 'utf-8')
  }

  return null
}

async function readWorkspaceAttachment(
  agent: { baseUrl: string; authHeader: string },
  path: string,
): Promise<Buffer | null> {
  const response = await workspaceAgentFetch<WorkspaceAgentReadResponse>(agent, '/files/read', {
    path,
  })
  if (!response.ok) return null

  const decoded = decodeWorkspaceAgentFileContent(response.data)
  if (!decoded || decoded.length === 0) return null
  if (decoded.length > MAX_PDF_BYTES_FOR_EXTRACTION) return null
  return decoded
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
  async (request: NextRequest, { slug }) => {
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

  const { sessionId, text, model, resume, messageId } = body as {
    sessionId: string
    text?: string
    model?: { providerId: string; modelId: string }
    attachments?: MessageAttachmentInput[]
    contextPaths?: string[]
    resume?: boolean
    messageId?: string
  }

  const attachments = normalizeMessageAttachments((body as { attachments?: unknown }).attachments)
  const contextPaths = normalizeContextPaths((body as { contextPaths?: unknown }).contextPaths)

  if (!sessionId || (!resume && !text && attachments.length === 0)) {
    return jsonErrorResponse(400, 'missing_fields')
  }

  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return jsonErrorResponse(400, 'too_many_attachments')
  }

  const password = decryptPassword(instance.serverPassword)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
  const baseUrl = getInstanceUrl(slug)
  const workspaceAgentUrl = getWorkspaceAgentUrl(slug)

  // Create SSE stream
  const encoder = new TextEncoder()

   const stream = new ReadableStream({
    async start(controller) {
      // Track whether the downstream client (browser) has disconnected.
      let clientGone = false
      let aborted = false
      let promptSent = Boolean(resume)
      let promptAcknowledged = Boolean(resume)

      // Shared reference so the abort path and finally block can always
      // clean up the active reader when it exists.
      let eventReader: ReadableStreamDefaultReader<Uint8Array> | null = null

      const handleAbort = () => {
        clientGone = true
        aborted = true
        void eventReader?.cancel().catch(() => undefined)
        try { controller.close() } catch { /* already closed/errored */ }
      }

      if (request.signal.aborted) {
        handleAbort()
        return
      }

      request.signal.addEventListener('abort', handleAbort, { once: true })

      const sendEvent = (event: string, data: unknown) => {
        if (clientGone) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          clientGone = true
        }
      }

        try {
          sendEvent('status', { status: 'connecting' })
          const readUpstreamSessionStatus = createUpstreamSessionStatusReader({
            baseUrl,
            authHeader,
            sessionId,
          })

          // Subscribe first so we don't miss fast session events.
          const eventsUrl = `${baseUrl}/event`

        const eventsResponse = await fetch(eventsUrl, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
          },
          signal: request.signal,
        })

        if (!eventsResponse.ok || !eventsResponse.body) {
          sendEvent('error', { error: 'Failed to connect to event stream' })
          return
        }

        const reader = eventsResponse.body.getReader()
        eventReader = reader
        const decoder = new TextDecoder()
        let parseState = INITIAL_SSE_PARSE_STATE

        const cancelReader = async () => {
          await reader.cancel().catch(() => undefined)
        }

        if (!resume) {
          const promptParts: Array<
            { type: 'text'; text: string } |
            { type: 'file'; mime: string; filename?: string; url: string }
          > = []

          if (typeof text === 'string' && text.trim().length > 0) {
            promptParts.push({ type: 'text', text })
          }

          if (contextPaths.length > 0) {
            promptParts.push({
              type: 'text',
              text: toContextReferenceText(contextPaths),
            })
          }

          if (attachments.length > 0) {
            const attachmentPathsForHint: string[] = []

            for (const attachment of attachments) {
              const attachmentPath = normalizeAttachmentPath(attachment.path)

              if (!isWorkspaceAttachmentPath(attachmentPath)) {
                sendEvent('error', { error: 'invalid_attachment_path' })
                await cancelReader()
                return
              }

              const fileName =
                attachment.filename ??
                attachmentPath.split('/').pop() ??
                'attachment'
              const attachmentMime = attachment.mime?.trim()
              const mime =
                attachmentMime &&
                attachmentMime.length > 0 &&
                attachmentMime !== 'application/octet-stream'
                  ? attachmentMime
                  : inferAttachmentMimeType(fileName)

              if (isPdfMime(mime)) {
                const attachmentBytes = await readWorkspaceAttachment(
                  { baseUrl: workspaceAgentUrl, authHeader },
                  attachmentPath,
                )

                if (attachmentBytes) {
                  const extracted = await extractPdfText(attachmentBytes, MAX_PDF_TEXT_CHARS)
                  if (extracted.ok) {
                    promptParts.push({
                      type: 'text',
                      text: toPdfExtractedTextPart(
                        attachmentPath,
                        extracted.text,
                        extracted.truncated,
                      ),
                    })
                  } else {
                    promptParts.push({
                      type: 'text',
                      text: toPdfExtractionFailureText(attachmentPath),
                    })
                  }
                } else {
                  promptParts.push({
                    type: 'text',
                    text: toPdfExtractionFailureText(attachmentPath),
                  })
                }

                attachmentPathsForHint.push(attachmentPath)
                continue
              }

              if (isSpreadsheetMimeType(mime)) {
                promptParts.push({
                  type: 'text',
                  text: toSpreadsheetToolHintText(attachmentPath),
                })
                attachmentPathsForHint.push(attachmentPath)
                continue
              }

              if (isDocumentMimeType(mime)) {
                promptParts.push({
                  type: 'text',
                  text: toDocumentToolHintText(attachmentPath),
                })
                attachmentPathsForHint.push(attachmentPath)
                continue
              }

              if (isPresentationMimeType(mime)) {
                promptParts.push({
                  type: 'text',
                  text: toPresentationToolHintText(attachmentPath),
                })
                attachmentPathsForHint.push(attachmentPath)
                continue
              }

              if (isImageMime(mime)) {
                const imageBytes = await readWorkspaceImageAttachment(
                  { baseUrl: workspaceAgentUrl, authHeader },
                  attachmentPath,
                )
                const workspaceFileUrl = toWorkspaceFileUrl(attachmentPath)

                if (imageBytes) {
                  const base64 = imageBytes.toString('base64')
                  promptParts.push({
                    type: 'file',
                    mime,
                    filename: fileName,
                    url: `data:${mime};base64,${base64}`,
                  })
                } else if (workspaceFileUrl) {
                  promptParts.push({
                    type: 'file',
                    mime,
                    filename: fileName,
                    url: workspaceFileUrl,
                  })
                }

                attachmentPathsForHint.push(attachmentPath)
                continue
              }

              const workspaceFileUrl = toWorkspaceFileUrl(attachmentPath)
              if (workspaceFileUrl) {
                promptParts.push({
                  type: 'file',
                  mime,
                  filename: fileName,
                  url: workspaceFileUrl,
                })
              }

              attachmentPathsForHint.push(attachmentPath)
            }

            if (attachmentPathsForHint.length > 0) {
              promptParts.push({
                type: 'text',
                text: toAttachmentHintText(attachmentPathsForHint),
              })
            }
          }

          if (promptParts.length === 0) {
            sendEvent('error', { error: 'missing_fields' })
            await cancelReader()
            return
          }

          const promptBody = {
            parts: promptParts,
            ...(model && {
              model: {
                providerID: resolveRuntimeProviderId(model.providerId),
                modelID: model.modelId,
              },
            })
          }

          const promptUrl = `${baseUrl}/session/${sessionId}/prompt_async`

          const promptResponse = await fetch(promptUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader
            },
            body: JSON.stringify(promptBody),
            signal: request.signal,
          })

          if (!promptResponse.ok) {
            const errorText = await promptResponse.text()
            sendEvent('error', { error: `Failed to start message: ${errorText}` })
            await cancelReader()
            return
          }

          promptSent = true
        }

        sendEvent('status', { status: 'thinking' })

        // Track state for the assistant response
        let currentStatus: string | null = null
        let currentToolName: string | undefined
        let currentDetail: string | undefined
        let assistantMessageId: string | null = messageId ?? null
        const messageRoles = new Map<string, string>()
        const seenPartMessageIds = new Set<string>()
        let assistantMessageSeen = typeof assistantMessageId === 'string'
        let assistantPartSeen = false
        let lastRelevantEventAt = Date.now()
        let lastStreamActivityAt = lastRelevantEventAt
        const relevantEventTimeoutMs = resume
          ? RESUME_STREAM_RELEVANT_EVENT_TIMEOUT_MS
          : SEND_STREAM_RELEVANT_EVENT_TIMEOUT_MS

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

        const finalizeFromIdle = () => {
          if (aborted) return

          const outcome = getIdleFinalizationOutcome({
            resume: Boolean(resume),
            assistantMessageSeen,
            assistantPartSeen,
          })

          if (outcome !== 'complete') {
            emitStatus('error', undefined, outcome)
            sendEvent('error', { error: outcome })
            aborted = true
            return
          }

          emitStatus('complete')
          sendEvent('done', { refresh: true })
          aborted = true
        }

        while (!aborted) {
          const readPromise = reader.read()
          let streamReadResult: ReadableStreamReadResult<Uint8Array> | null = null

          while (!aborted && !streamReadResult) {
            const readResult = await Promise.race([
              readPromise.then((result) => ({ type: 'data' as const, result })),
              new Promise<{ type: 'tick' }>((resolve) =>
                setTimeout(() => resolve({ type: 'tick' }), STREAM_RELEVANT_EVENT_TICK_MS)
              ),
            ])

            if (readResult.type === 'tick') {
              if (Date.now() - lastRelevantEventAt > relevantEventTimeoutMs) {
                const watchdogOutcome = getSilentStreamOutcome(
                  {
                    upstreamStatus: await readUpstreamSessionStatus(),
                    silentForMs: Date.now() - lastStreamActivityAt,
                    relevantEventTimeoutMs,
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

                emitStatus('error', undefined, 'stream_timeout')
                sendEvent('error', { error: 'stream_timeout' })
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
            if (!resume && !aborted) {
              finalizeFromIdle()
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
                  event.properties?.sessionID ||
                  event.properties?.info?.sessionID ||
                  event.properties?.part?.sessionID

                const eventType = typeof event.type === 'string' ? event.type : ''
                const isWorkspaceEvent =
                  eventType === 'file.edited' ||
                  eventType === 'file.created' ||
                  eventType === 'file.deleted' ||
                  eventType === 'todo.updated'

                const isSessionScopedEvent =
                  eventType === 'session.status' ||
                  eventType === 'session.idle' ||
                  eventType === 'session.error'

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

                    if (status?.type === 'busy') {
                      promptSent = true
                      promptAcknowledged = true
                      emitStatus('thinking')
                    } else if (status?.type === 'retry') {
                      promptAcknowledged = true
                      emitStatus('thinking', undefined, status?.message)
                    } else if (status?.type === 'idle') {
                      if (!promptSent || !promptAcknowledged) {
                        break
                      }
                      finalizeFromIdle()
                    }
                    break
                  }

                  case 'session.idle': {
                    markRelevantEvent()
                    if (!promptSent || !promptAcknowledged) {
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
                    aborted = true
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
                      promptAcknowledged = true
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

                    promptAcknowledged = true
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
                    if (typeof part.type !== 'string') {
                      part.type = typeof properties?.partType === 'string' ? properties.partType : 'text'
                    }
                    if (typeof part.messageID !== 'string') {
                      part.messageID = partMessageId
                    }
                    if (typeof part.sessionID !== 'string' && typeof eventSessionId === 'string') {
                      part.sessionID = eventSessionId
                    }

                    sendEvent('part', { messageId: partMessageId, part, delta })

                    if (!isAssistantPart) break

                    promptAcknowledged = true
                    assistantPartSeen = true

                    const partType = typeof part.type === 'string' ? part.type : 'text'
                    if (partType === 'reasoning') {
                      emitStatus('reasoning')
                    } else if (partType === 'text') {
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
          sendEvent('error', {
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      } finally {
        request.signal.removeEventListener('abort', handleAbort)
        if (eventReader) {
          await eventReader.cancel().catch(() => undefined)
        }
        try { controller.close() } catch { /* already closed/errored */ }
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
  },
)
