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
  record: ReturnType<typeof kbGithubRemoteService.decryptIntegrationConfig> extends infer _C
    ? { state: Awaited<ReturnType<typeof kbGithubRemoteService.getSyncState>>; version: number; updatedAt: Date } | null
    : never,
  config: { appId?: string; privateKey?: string; appSlug?: string } | null,
): KbGithubRemoteIntegrationGetResponse {
  const state = record?.state
  return {
    appId: config?.appId ?? null,
    appSlug: config?.appSlug ?? null,
    appConfigured: Boolean(config?.appId && config?.privateKey),
    hasPrivateKey: Boolean(config?.privateKey),
    installationId: state?.installationId ?? null,
    repoFullName: state?.repoFullName ?? null,
    ready: Boolean(config?.appId && config?.privateKey && state?.installationId && state?.repoCloneUrl),
    lastSyncAt: state?.lastSyncAt ?? null,
    lastSyncStatus:
      state?.lastSyncStatus === 'success' ||
      state?.lastSyncStatus === 'error' ||
      state?.lastSyncStatus === 'conflicts'
        ? state.lastSyncStatus
        : null,
    lastError: state?.lastError ?? null,
    remoteBranch: state?.remoteBranch ?? null,
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
    const appId = typeof body.appId === 'string' ? body.appId.trim() : ''
    const privateKey = typeof body.privateKey === 'string' ? body.privateKey.trim() : ''
    const appSlug = typeof body.appSlug === 'string' ? body.appSlug.trim() : ''

    if (!appId) {
      return toErrorResponse('missing_app_id', 400)
    }

    const existing = await kbGithubRemoteService.findIntegration()
    const existingConfig = existing ? kbGithubRemoteService.decryptIntegrationConfig(existing) : null
    const hasExistingKey = Boolean(existingConfig?.privateKey)

    if (!privateKey && !hasExistingKey) {
      return toErrorResponse('missing_private_key', 400)
    }

    const record = await kbGithubRemoteService.saveIntegrationConfig({
      appId,
      privateKey: privateKey || null,
      appSlug: appSlug || null,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.updated',
      metadata: { appConfigured: Boolean(appId && (privateKey || hasExistingKey)) },
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
