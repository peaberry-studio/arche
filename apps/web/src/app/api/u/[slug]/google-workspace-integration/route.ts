import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import type {
  GoogleWorkspaceIntegrationGetResponse,
  GoogleWorkspaceIntegrationMutateRequest,
  GoogleWorkspaceIntegrationMutateResponse,
} from '@/lib/google-workspace/types'
import { googleWorkspaceService } from '@/lib/services'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'

type JsonObject = Record<string, unknown>

function toErrorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function requireAdmin(user: { id: string; role: string }) {
  const denied = requireCapability('googleWorkspaceIntegration')
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
  record: { version: number; updatedAt: Date } | null,
  resolved: { clientId?: string; clientSecret?: string } | null,
): GoogleWorkspaceIntegrationGetResponse {
  return {
    clientId: resolved?.clientId ?? null,
    configured: Boolean(resolved?.clientId && resolved?.clientSecret),
    hasClientSecret: Boolean(resolved?.clientSecret),
    version: record?.version ?? 0,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
  }
}

export const GET = withAuth<GoogleWorkspaceIntegrationGetResponse | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await googleWorkspaceService.ensureIntegrationSeededFromEnv()
    const config = record ? googleWorkspaceService.decryptIntegrationConfig(record) : null

    return NextResponse.json(serializeResponse(record, config))
  },
)

export const PUT = withAuth<GoogleWorkspaceIntegrationMutateResponse | { error: string }>(
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

    const body = parsedBody.body as GoogleWorkspaceIntegrationMutateRequest
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : ''

    const existing = await googleWorkspaceService.findIntegration()
    const existingConfig = existing ? googleWorkspaceService.decryptIntegrationConfig(existing) : null

    const hasExistingSecret = Boolean(existingConfig?.clientSecret)

    if (!clientId) {
      return toErrorResponse('missing_client_id', 400)
    }

    if (!clientSecret && !hasExistingSecret) {
      return toErrorResponse('missing_client_secret', 400)
    }

    const record = await googleWorkspaceService.saveIntegrationConfig({
      clientId,
      clientSecret: clientSecret || null,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'google_workspace_integration.updated',
      metadata: { configured: Boolean(clientId && (clientSecret || hasExistingSecret)) },
    })

    const resolved = await googleWorkspaceService.getResolvedCredentials()
    return NextResponse.json(serializeResponse(record, resolved))
  },
)

export const DELETE = withAuth<GoogleWorkspaceIntegrationMutateResponse | { error: string }>(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await googleWorkspaceService.clearIntegration()

    await auditEvent({
      actorUserId: user.id,
      action: 'google_workspace_integration.deleted',
    })

    return NextResponse.json(serializeResponse(record, null))
  },
)
