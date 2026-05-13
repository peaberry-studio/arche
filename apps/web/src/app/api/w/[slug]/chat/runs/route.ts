import { NextRequest, NextResponse } from 'next/server'

import { getInstanceUrl } from '@/lib/opencode/client'
import {
  buildWorkspacePromptParts,
  normalizeContextPaths,
  normalizeMessageAttachments,
} from '@/lib/opencode/workspace-prompt'
import { resolveRuntimeProviderId } from '@/lib/providers/catalog'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService, messageRunService } from '@/lib/services'
import type { ActiveRunRuntimeState, MessageRunRecord } from '@/lib/services/message-run'
import { decryptPassword } from '@/lib/spawner/crypto'
import { getWorkspaceAgentUrl } from '@/lib/workspace-agent/client'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/workspace-attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROMPT_START_TIMEOUT_MS = 60_000

type StartPromptBody = {
  sessionId?: string
  text?: string
  model?: { providerId: string; modelId: string }
  attachments?: unknown
  contextPaths?: unknown
}

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseStartPromptBody(body: unknown): StartPromptBody {
  if (!isRecord(body)) return {}

  const model = isRecord(body.model)
    ? {
        providerId: getString(body.model.providerId) ?? '',
        modelId: getString(body.model.modelId) ?? '',
      }
    : undefined

  return {
    sessionId: getString(body.sessionId),
    text: getString(body.text),
    model: model?.providerId && model.modelId ? model : undefined,
    attachments: body.attachments,
    contextPaths: body.contextPaths,
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

function serializeRun(run: MessageRunRecord) {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    source: run.source,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
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

async function getInstanceConnection(slug: string) {
  const instance = await instanceService.findCredentialsBySlug(slug)

  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return null
  }

  const password = decryptPassword(instance.serverPassword)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
  return {
    authHeader,
    baseUrl: getInstanceUrl(slug),
    workspaceAgentUrl: getWorkspaceAgentUrl(slug),
  }
}

export const GET = withAuth(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim()
    if (!sessionId) {
      return jsonErrorResponse(400, 'missing_fields')
    }

    const activeRun = await messageRunService.findActiveRun(slug, sessionId)
    if (!activeRun) {
      return NextResponse.json({ activeRun: null })
    }

    if (activeRun.status !== 'running') {
      await messageRunService.markActiveRunSucceeded(slug, sessionId)
      return NextResponse.json({ activeRun: null })
    }

    const connection = await getInstanceConnection(slug)
    if (!connection) {
      return jsonErrorResponse(503, 'instance_unavailable')
    }

    const runtimeState = await readRuntimeSessionState({
      authHeader: connection.authHeader,
      baseUrl: connection.baseUrl,
      sessionId,
    })
    if (runtimeState === 'idle') {
      await messageRunService.markRunSucceeded(activeRun.id)
      return NextResponse.json({ activeRun: null })
    }

    return NextResponse.json({ activeRun: serializeRun(activeRun) })
  },
)

export const POST = withAuth(
  { csrf: true },
  async (request: NextRequest, { slug }) => {
    const connection = await getInstanceConnection(slug)
    if (!connection) {
      return jsonErrorResponse(503, 'instance_unavailable')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonErrorResponse(400, 'invalid_json')
    }

    const input = parseStartPromptBody(body)
    const sessionId = input.sessionId?.trim()
    const attachments = normalizeMessageAttachments(input.attachments)
    const contextPaths = normalizeContextPaths(input.contextPaths)

    if (!sessionId || (!input.text && attachments.length === 0)) {
      return jsonErrorResponse(400, 'missing_fields')
    }

    if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      return jsonErrorResponse(400, 'too_many_attachments')
    }

    const prompt = await buildWorkspacePromptParts({
      agent: { baseUrl: connection.workspaceAgentUrl, authHeader: connection.authHeader },
      attachments,
      contextPaths,
      text: input.text,
    })
    if (!prompt.ok) {
      return jsonErrorResponse(400, prompt.error)
    }

    const runResult = await messageRunService.createActiveRunAfterRuntimeStateCheck({
      readRuntimeSessionState: () => readRuntimeSessionState({
        authHeader: connection.authHeader,
        baseUrl: connection.baseUrl,
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
          activeRun: runResult.activeRun ? serializeRun(runResult.activeRun) : null,
        },
        { status: 409 },
      )
    }

    const runId = runResult.run.id
    const promptBody = {
      parts: prompt.parts,
      ...(input.model && {
        model: {
          providerID: resolveRuntimeProviderId(input.model.providerId),
          modelID: input.model.modelId,
        },
      }),
    }

    const promptStartSignal = AbortSignal.timeout(PROMPT_START_TIMEOUT_MS)
    let promptResponse: Response
    try {
      promptResponse = await fetch(`${connection.baseUrl}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: connection.authHeader,
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
      await messageRunService.markRunFailed(runId, detail)
      return jsonErrorResponse(502, detail)
    }

    if (!promptResponse.ok) {
      const errorText = await promptResponse.text()
      const detail = `Failed to start message: ${errorText}`
      await messageRunService.markRunFailed(runId, detail)
      return jsonErrorResponse(502, detail)
    }

    return NextResponse.json({ runId, sessionId, status: 'running' })
  },
)
