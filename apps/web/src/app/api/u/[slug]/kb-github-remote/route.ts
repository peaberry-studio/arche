import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import type {
  KbGithubRemoteIntegrationGetResponse,
  KbGithubRemoteIntegrationMutateRequest,
  KbGithubRemoteIntegrationMutateResponse,
} from '@/lib/kb-github-remote/types'
import { kbGithubRemoteService } from '@/lib/services'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'

type JsonObject = Record<string, unknown>

function toErrorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function requireAdmin(user: { id: string; role: string }) {
  const denied = requireCapability('kbGithubSync')
  if (denied) {
    return { ok: false as const, response: denied }
  }

  if (user.role !== 'ADMIN') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { ok: true as const }
}

async function parseJsonObject(request: NextRequest): Promise<
  | { ok: true; body: JsonObject }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  let body: unknown

  try {
    body = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        response: toErrorResponse('invalid_json', 400),
      }
    }

    throw error
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: toErrorResponse('invalid_body', 400),
    }
  }

  return { ok: true, body: body as JsonObject }
}

function serializeResponse(
  record: { state: { lastSyncAt: string | null; lastSyncStatus: string | null; lastError: string | null; remoteBranch: string | null }; version: number; updatedAt: Date } | null,
  config: { repoUrl?: string; pat?: string } | null,
): KbGithubRemoteIntegrationGetResponse {
  return {
    repoUrl: config?.repoUrl ?? null,
    configured: Boolean(config?.repoUrl && config?.pat),
    hasPat: Boolean(config?.pat),
    lastSyncAt: record?.state.lastSyncAt ?? null,
    lastSyncStatus:
      record?.state.lastSyncStatus === 'success' ||
      record?.state.lastSyncStatus === 'error' ||
      record?.state.lastSyncStatus === 'conflicts'
        ? record.state.lastSyncStatus
        : null,
    lastError: record?.state.lastError ?? null,
    remoteBranch: record?.state.remoteBranch ?? null,
    version: record?.version ?? 0,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
  }
}

export const GET = withAuth<KbGithubRemoteIntegrationGetResponse | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.findIntegration()
    const config = record ? kbGithubRemoteService.decryptIntegrationConfig(record) : null

    return NextResponse.json(serializeResponse(record, config))
  },
)

export const PUT = withAuth<KbGithubRemoteIntegrationMutateResponse | { error: string }>(
  { csrf: true },
  async (request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const parsedBody = await parseJsonObject(request)
    if (!parsedBody.ok) {
      return parsedBody.response
    }

    const body = parsedBody.body as KbGithubRemoteIntegrationMutateRequest
    const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim() : ''
    const pat = typeof body.pat === 'string' ? body.pat.trim() : ''

    if (!repoUrl) {
      return toErrorResponse('missing_repo_url', 400)
    }

    if (!repoUrl.startsWith('https://')) {
      return toErrorResponse('invalid_repo_url', 400)
    }

    const existing = await kbGithubRemoteService.findIntegration()
    const existingConfig = existing ? kbGithubRemoteService.decryptIntegrationConfig(existing) : null
    const hasExistingPat = Boolean(existingConfig?.pat)

    if (!pat && !hasExistingPat) {
      return toErrorResponse('missing_pat', 400)
    }

    const record = await kbGithubRemoteService.saveIntegrationConfig({
      repoUrl,
      pat: pat || null,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.updated',
      metadata: { configured: Boolean(repoUrl && (pat || hasExistingPat)) },
    })

    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    return NextResponse.json(serializeResponse(record, config))
  },
)

export const DELETE = withAuth<KbGithubRemoteIntegrationMutateResponse | { error: string }>(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.clearIntegration()

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.deleted',
    })

    return NextResponse.json(serializeResponse(record, null))
  },
)
