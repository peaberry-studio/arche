import { NextRequest, NextResponse } from 'next/server'

import { getInstanceUrl } from '@/lib/opencode/client'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'

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
>({ csrf: true }, async (request: NextRequest, { slug, params: { permissionId } }) => {
  const instance = await instanceService.findCredentialsBySlug(slug)

  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return jsonErrorResponse(503, 'instance_unavailable')
  }

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

  const password = decryptPassword(instance.serverPassword)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
  const baseUrl = getInstanceUrl(slug)
  const response = await fetch(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({ response: body.response }),
      signal: request.signal,
    },
  )

  if (!response.ok) {
    return jsonErrorResponse(response.status >= 400 && response.status < 500 ? response.status : 502, 'permission_reply_failed')
  }

  return NextResponse.json({ ok: true })
})
