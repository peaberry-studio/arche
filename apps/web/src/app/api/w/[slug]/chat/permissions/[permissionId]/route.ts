import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import { withAuth } from '@/lib/runtime/with-auth'

type PermissionReplyResponse = 'once' | 'always' | 'reject'

type ReplyPermissionRequest = {
  sessionId?: unknown
  response?: unknown
}

function isPermissionReplyResponse(value: unknown): value is PermissionReplyResponse {
  return value === 'once' || value === 'always' || value === 'reject'
}

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export const POST = withAuth<
  { ok: true } | { error: string },
  { slug: string; permissionId: string }
>({ csrf: true }, async (request: NextRequest, { slug, params: { permissionId }, user }) => {
  const runtimeResult = await getRuntimeForSlug(slug)
  if (!runtimeResult.ok) return jsonErrorResponse(503, runtimeResult.error.code)
  const client = runtimeResult.data

  let body: ReplyPermissionRequest
  try {
    body = await request.json()
  } catch {
    return jsonErrorResponse(400, 'invalid_json')
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.trim()
    : null
  if (!sessionId || !isPermissionReplyResponse(body.response)) {
    return jsonErrorResponse(400, 'missing_fields')
  }

  const response = await client.replyPermission({
    sessionId,
    permissionId,
    response: body.response,
  }, { signal: request.signal })

  if (!response.ok) {
    if (response.error.code === 'instance_unavailable') return jsonErrorResponse(503, response.error.code)
    const status = response.error.status
    return jsonErrorResponse(status && status >= 400 && status < 500 ? status : 502, 'permission_reply_failed')
  }

  await auditEvent({
    actorUserId: user.id,
    action: 'workspace.permission_replied',
    metadata: { permissionId, response: body.response, sessionId, slug },
  })

  return NextResponse.json({ ok: true })
})
