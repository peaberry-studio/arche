import { NextRequest, NextResponse } from 'next/server'

import { getInstanceUrl } from '@/lib/opencode/client'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService, messageRunService } from '@/lib/services'
import type { ActiveRunRuntimeState, MessageRunRecord } from '@/lib/services/message-run'
import { decryptPassword } from '@/lib/spawner/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
  async () => jsonErrorResponse(410, 'prompt_start_moved_to_stream'),
)
