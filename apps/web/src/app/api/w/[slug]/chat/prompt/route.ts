import { NextRequest, NextResponse } from 'next/server'

import { getInstanceUrl } from '@/lib/opencode/client'
import { ensureProviderAccessFreshForExecution } from '@/lib/opencode/providers'
import {
  buildWorkspacePromptParts,
  normalizeContextPaths,
  normalizeMessageAttachments,
} from '@/lib/opencode/workspace-prompt'
import { resolveRuntimeProviderId } from '@/lib/providers/catalog'
import { getString, isRecord } from '@/lib/records'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService, messageRunService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'
import { getWorkspaceAgentUrl } from '@/lib/workspace-agent/client'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/workspace-attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ParsedPromptRequest = {
  sessionId: string
  messageId: string
  text?: string
  model?: Record<string, unknown>
  attachments?: unknown
  contextPaths?: unknown
}

type OpenCodePromptBody = {
  id?: string
  parts: unknown[]
  model?: { providerID: string; modelID: string }
}

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

type SessionRuntimeState = 'busy' | 'idle' | 'unknown'

async function readSessionRuntimeState(baseUrl: string, authHeader: string, sessionId: string): Promise<SessionRuntimeState> {
  try {
    const response = await fetch(`${baseUrl}/session/status`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return 'unknown'
    const data: unknown = await response.json()
    if (!isRecord(data)) return 'unknown'
    const record = data[sessionId]
    if (!isRecord(record)) return 'idle'
    if (record.type === 'busy' || record.type === 'retry') return 'busy'
    if (record.type === 'idle') return 'idle'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

function parsePromptBody(body: unknown): ParsedPromptRequest | null {
  if (!isRecord(body)) return null
  const sessionId = getString(body.sessionId)
  const messageId = getString(body.messageId)
  if (!sessionId || !messageId) return null
  return {
    sessionId,
    messageId,
    text: getString(body.text),
    model: isRecord(body.model) ? body.model : undefined,
    attachments: body.attachments,
    contextPaths: body.contextPaths,
  }
}

/**
 * Fire-and-forget prompt. The handler opens no /event pipe, waits for no
 * tokens, and never emits `done`. OpenCode keeps the session running; the
 * client's event bus applies the outcome.
 */
export const POST = withAuth<
  { ok: true } | { error: string },
  { slug: string }
>({ csrf: true }, async (request: NextRequest, { slug, user }) => {
  const instance = await instanceService.findCredentialsBySlug(slug)

  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return jsonErrorResponse(503, 'instance_unavailable')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonErrorResponse(400, 'invalid_json')
  }

  const requestBody = parsePromptBody(body)
  if (!requestBody) {
    return jsonErrorResponse(400, 'missing_fields')
  }

  const sessionId = requestBody.sessionId
  const messageId = requestBody.messageId
  const attachments = normalizeMessageAttachments(requestBody.attachments)
  const contextPaths = normalizeContextPaths(requestBody.contextPaths)
  const text = requestBody.text
  const model = requestBody.model
    ? {
        providerId: getString(requestBody.model.providerId) ?? '',
        modelId: getString(requestBody.model.modelId) ?? '',
      }
    : null
  const hasPromptInput = Boolean(text) || attachments.length > 0
  if (!hasPromptInput) {
    return jsonErrorResponse(400, 'missing_fields')
  }

  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return jsonErrorResponse(400, 'too_many_attachments')
  }

  const password = decryptPassword(instance.serverPassword)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
  const baseUrl = getInstanceUrl(slug)
  const workspaceAgentUrl = getWorkspaceAgentUrl(slug)

  const runtimeState = await readSessionRuntimeState(baseUrl, authHeader, sessionId)
  if (runtimeState === 'busy') {
    return jsonErrorResponse(409, 'session_busy')
  }

  // Respect the slack/flow lock. If OpenCode is idle and only a stale lock
  // remains, reap it (the run finished) and continue. If status is unknown,
  // skip the reap but still refuse when a run is actively locked.
  const activeRun = await messageRunService.findActiveRun(slug, sessionId)
  if (activeRun?.status === 'running') {
    if (runtimeState === 'unknown') {
      return jsonErrorResponse(409, 'session_busy')
    }
    await messageRunService.markActiveRunSucceeded(slug, sessionId).catch(() => undefined)
  }

  const built = await buildWorkspacePromptParts({
    agent: { baseUrl: workspaceAgentUrl, authHeader },
    attachments,
    contextPaths,
    text,
  })
  if (!built.ok) {
    return jsonErrorResponse(400, built.error)
  }

  const promptBody: OpenCodePromptBody = {
    id: messageId,
    parts: built.parts,
    ...(model?.providerId && model.modelId
      ? {
          model: {
            providerID: resolveRuntimeProviderId(model.providerId),
            modelID: model.modelId,
          },
        }
      : {}),
  }

  try {
    await ensureProviderAccessFreshForExecution({ slug, userId: user.id })
  } catch {
    // Provider sync is best-effort here; the prompt still reaches OpenCode.
  }

  let promptResponse: Response
  try {
    // sessionId is client-supplied; encode it so it cannot alter the upstream
    // path (e.g. "../" or query separators).
    promptResponse = await fetch(
      `${baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(promptBody),
        signal: AbortSignal.timeout(60_000),
      },
    )
  } catch {
    return jsonErrorResponse(502, 'prompt_failed')
  }

  if (!promptResponse.ok) {
    return jsonErrorResponse(502, 'prompt_failed')
  }

  return NextResponse.json({ ok: true }, { status: 202 })
})
