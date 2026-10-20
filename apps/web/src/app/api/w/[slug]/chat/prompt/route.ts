import { NextRequest, NextResponse } from 'next/server'

import { readSessionFamilyRuntimeState } from '@/lib/harness/execution'
import {
  buildWorkspacePromptParts,
  getRuntimeForSlug,
  normalizeContextPaths,
  normalizeMessageAttachments,
} from '@/lib/harness/registry'
import { getString, isRecord } from '@/lib/records'
import { withAuth } from '@/lib/runtime/with-auth'
import { getWorkspaceAgentConnection } from '@/lib/runtime/workspace-host'
import { messageRunService, userService } from '@/lib/services'
import * as legacySessionArchive from '@/lib/services/legacy-session-archive'
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

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
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
 * tokens, and never emits `done`. The runtime keeps the session running; the
 * client's event bus applies the outcome.
 */
export const POST = withAuth<
  { ok: true } | { error: string },
  { slug: string }
>({ csrf: true }, async (request: NextRequest, { slug, user }) => {
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
  if (await legacySessionArchive.isArchivedSession(slug, sessionId)) {
    return jsonErrorResponse(409, 'session_archived')
  }
  const ownerUserId = user.slug === slug ? user.id : (await userService.findIdBySlug(slug))?.id
  if (!ownerUserId) return jsonErrorResponse(404, 'user_not_found')
  const runtimeResult = await getRuntimeForSlug(slug)
  if (!runtimeResult.ok) return jsonErrorResponse(503, runtimeResult.error.code)
  const client = runtimeResult.data
  const agent = await getWorkspaceAgentConnection(slug)
  if (!agent) return jsonErrorResponse(503, 'instance_unavailable')

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

  const runtimeState = await readSessionFamilyRuntimeState(client, sessionId)
  if (runtimeState === 'not_found') return jsonErrorResponse(404, 'session_not_found')
  if (runtimeState !== 'idle') {
    return jsonErrorResponse(409, 'session_busy')
  }

  const activeRun = await messageRunService.findActiveRun(slug, sessionId)
  if (activeRun?.status === 'running') {
    await messageRunService.markActiveRunSucceeded(slug, sessionId).catch(() => undefined)
  }

  const built = await buildWorkspacePromptParts({
    agent,
    attachments,
    contextPaths,
    text,
  })
  if (!built.ok) {
    return jsonErrorResponse(400, built.error)
  }

  try {
    await client.syncProviderAccess({ userId: ownerUserId })
  } catch {
    // Provider sync is best-effort here; the prompt still reaches the runtime.
  }

  try {
    const submitted = await client.prompt({
      sessionId,
      messageId,
      parts: built.parts,
      ...(model?.providerId && model.modelId ? { model } : {}),
    }, { signal: AbortSignal.timeout(60_000) })
    if (!submitted.ok) {
      if (submitted.error.code === 'session_not_found') return jsonErrorResponse(404, submitted.error.code)
      if (submitted.error.code === 'session_busy') return jsonErrorResponse(409, submitted.error.code)
      return jsonErrorResponse(502, 'prompt_failed')
    }
  } catch {
    return jsonErrorResponse(502, 'prompt_failed')
  }

  return NextResponse.json({ ok: true }, { status: 202 })
})
