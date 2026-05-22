import { createHash } from 'node:crypto'

import { getClientIp } from '@/lib/http'
import { authenticatePat } from '@/lib/mcp/auth'
import { getMcpRequestMetadata, handleMcpJsonRpcRequest } from '@/lib/mcp/server'
import { auditService, mcpSettingsService, rateLimitService } from '@/lib/services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MCP_MAX_BODY_BYTES = 64 * 1024
const MCP_PREAUTH_RATE_LIMIT_MAX = 300
const MCP_PREAUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000
const MCP_TOKEN_RATE_LIMIT_MAX = 100
const MCP_TOKEN_RATE_LIMIT_WINDOW_MS = 60 * 1000

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'accept, authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Max-Age': '600',
    },
  })
}

export async function POST(request: Request): Promise<Response> {
  if (isContentLengthTooLarge(request.headers)) {
    return jsonResponse({ error: 'payload_too_large' }, { status: 413 })
  }

  const clientSubject = getPreAuthSubject(request.headers)
  const preAuthRateLimit = await rateLimitService.checkDbRateLimit(
    `mcp:preauth:${clientSubject}`,
    MCP_PREAUTH_RATE_LIMIT_MAX,
    MCP_PREAUTH_RATE_LIMIT_WINDOW_MS
  )
  if (!preAuthRateLimit.allowed) return rateLimitedResponse(preAuthRateLimit.resetAt)

  const auth = await authenticatePat(request)
  if (!auth.ok) {
    return jsonResponse({ error: 'unauthorized' }, { status: auth.status })
  }

  const tokenRateLimit = await rateLimitService.checkDbRateLimit(
    `mcp:token:${auth.tokenId}`,
    MCP_TOKEN_RATE_LIMIT_MAX,
    MCP_TOKEN_RATE_LIMIT_WINDOW_MS
  )
  if (!tokenRateLimit.allowed) return rateLimitedResponse(tokenRateLimit.resetAt)

  const bodyResult = await readRequestBody(request)
  if (!bodyResult.ok) {
    await auditMcpRequest(request, auth, { method: null, toolName: null })
    return jsonResponse({ error: bodyResult.error }, { status: bodyResult.error === 'payload_too_large' ? 413 : 400 })
  }

  const parsedBody = parseBody(bodyResult.body)
  if (!parsedBody.ok) {
    await auditMcpRequest(request, auth, { method: null, toolName: null })
    return jsonResponse({ error: 'invalid_json' }, { status: 400 })
  }
  if (Array.isArray(parsedBody.body)) return jsonResponse({ error: 'batch_not_supported' }, { status: 400 })

  const metadata = getMcpRequestMetadata(parsedBody.body)
  await auditMcpRequest(request, auth, metadata)

  const settings = await mcpSettingsService.getSettings()
  if (!settings.enabled || !auth.user.mcpAllowed) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  }

  return withCorsHeaders(await handleMcpJsonRpcRequest({
    body: parsedBody.body,
    scopes: auth.scopes,
    user: auth.user,
  }))
}

async function auditMcpRequest(
  request: Request,
  auth: Extract<Awaited<ReturnType<typeof authenticatePat>>, { ok: true }>,
  metadata: ReturnType<typeof getMcpRequestMetadata>
): Promise<void> {
  await auditService.createEvent({
    actorUserId: auth.user.id,
    action: 'mcp.request',
    metadata: {
      ip: getClientIp(request.headers),
      method: metadata.method,
      tokenId: auth.tokenId,
      toolName: metadata.toolName,
    },
  })
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return withCorsHeaders(Response.json(body, init))
}

function withCorsHeaders(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Vary', 'Origin')
  return response
}

function rateLimitedResponse(resetAt: number): Response {
  return jsonResponse(
    { error: 'rate_limited' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) },
    }
  )
}

function isContentLengthTooLarge(headers: Headers): boolean {
  const contentLength = Number.parseInt(headers.get('content-length') ?? '', 10)
  return Number.isFinite(contentLength) && contentLength > MCP_MAX_BODY_BYTES
}

async function readRequestBody(request: Request): Promise<
  | { ok: true; body: string }
  | { ok: false; error: 'invalid_json' | 'payload_too_large' }
> {
  if (!request.body) return { ok: true, body: '' }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        chunks.push(decoder.decode())
        return { ok: true, body: chunks.join('') }
      }

      bytesRead += value.byteLength
      if (bytesRead > MCP_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return { ok: false, error: 'payload_too_large' }
      }

      chunks.push(decoder.decode(value, { stream: true }))
    }
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
}

function parseBody(body: string): { ok: true; body: unknown } | { ok: false } {
  try {
    return { ok: true, body: JSON.parse(body) }
  } catch {
    return { ok: false }
  }
}

function getPreAuthSubject(headers: Headers): string {
  const ip = getClientIp(headers)
  if (ip) return `ip:${ip}`

  const userAgent = headers.get('user-agent') ?? 'missing-user-agent'
  const hash = createHash('sha256').update(userAgent).digest('hex').slice(0, 24)
  return `ua:${hash}`
}
