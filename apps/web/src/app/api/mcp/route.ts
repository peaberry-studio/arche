import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { getClientIp } from '@/lib/http'
import { authenticatePat } from '@/lib/mcp/auth'
import { createMcpServer } from '@/lib/mcp/server'
import { readMcpSettings } from '@/lib/mcp/settings'
import { checkRateLimit } from '@/lib/rate-limit'
import { auditService } from '@/lib/services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MCP_RATE_LIMIT_MAX = 100
const MCP_RATE_LIMIT_WINDOW_MS = 60 * 1000
const MCP_PREAUTH_RATE_LIMIT_MAX = 300
const MCP_PREAUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000
const MCP_MAX_BODY_BYTES = 64 * 1024

export async function POST(request: Request): Promise<Response> {
  if (isRequestBodyTooLarge(request.headers)) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const clientIp = getClientIp(request.headers) ?? 'unknown'
  const preAuthRateLimit = checkRateLimit(
    `mcp:ip:${clientIp}`,
    MCP_PREAUTH_RATE_LIMIT_MAX,
    MCP_PREAUTH_RATE_LIMIT_WINDOW_MS
  )
  if (!preAuthRateLimit.allowed) {
    return buildRateLimitedResponse(preAuthRateLimit.resetAt)
  }

  const mcpSettings = await readMcpSettings()
  if (!mcpSettings.ok) {
    return Response.json({ error: 'mcp_unavailable' }, { status: 503 })
  }

  if (!mcpSettings.enabled) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const auth = await authenticatePat(request)
  if (!auth.ok) {
    return Response.json({ error: 'unauthorized' }, { status: auth.status })
  }

  const rateLimit = checkRateLimit(`mcp:${auth.tokenId}`, MCP_RATE_LIMIT_MAX, MCP_RATE_LIMIT_WINDOW_MS)
  if (!rateLimit.allowed) {
    return buildRateLimitedResponse(rateLimit.resetAt)
  }

  const bodyResult = await readRequestBody(request)
  if (!bodyResult.ok) {
    return Response.json(
      { error: bodyResult.error },
      { status: bodyResult.error === 'payload_too_large' ? 413 : 400 }
    )
  }

  const parsedBody = parseBody(bodyResult.body)
  if (!parsedBody) {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (isInitializedNotification(parsedBody.value)) {
    return new Response('', {
      status: 202,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  await auditService.createEvent({
    actorUserId: auth.user.id,
    action: 'mcp.request',
    metadata: {
      ip: clientIp,
      method: getRequestMethod(parsedBody.value),
      tokenId: auth.tokenId,
      toolName: getToolName(parsedBody.value),
    },
  })

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  })
  const server = createMcpServer({
    scopes: auth.scopes,
    user: auth.user,
  })
  const forwardedRequest = buildTransportRequest(request, bodyResult.body)

  await server.connect(transport)
  return transport.handleRequest(forwardedRequest, { parsedBody: parsedBody.value })
}

function buildRateLimitedResponse(resetAt: number): Response {
  return Response.json(
    { error: 'rate_limited' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
      },
    }
  )
}

function isRequestBodyTooLarge(headers: Headers): boolean {
  const contentLength = Number.parseInt(headers.get('content-length') ?? '', 10)
  return Number.isFinite(contentLength) && contentLength > MCP_MAX_BODY_BYTES
}

async function readRequestBody(
  request: Request
): Promise<
  | { ok: true; body: string }
  | { ok: false; error: 'invalid_json' | 'payload_too_large' }
> {
  if (!request.body) {
    return { ok: true, body: '' }
  }

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

function parseBody(bodyText: string): { value: unknown } | null {
  try {
    return {
      value: JSON.parse(bodyText),
    }
  } catch {
    return null
  }
}

function buildTransportRequest(request: Request, rawBody: string | null): Request {
  const headers = new Headers(request.headers)
  const accept = headers.get('accept')

  if (!accept || !accept.includes('application/json') || !accept.includes('text/event-stream')) {
    headers.set('accept', 'application/json, text/event-stream')
  }

  return new Request(request.url, {
    method: request.method,
    headers,
    body: rawBody,
  })
}

function getRequestMethod(parsedBody: unknown): string | null {
  if (!parsedBody || typeof parsedBody !== 'object') {
    return null
  }

  return typeof (parsedBody as { method?: unknown }).method === 'string'
    ? (parsedBody as { method: string }).method
    : null
}

function getToolName(parsedBody: unknown): string | null {
  if (!parsedBody || typeof parsedBody !== 'object') {
    return null
  }

  const body = parsedBody as {
    method?: unknown
    params?: { name?: unknown }
  }

  if (body.method !== 'tools/call') {
    return null
  }

  return typeof body.params?.name === 'string' ? body.params.name : null
}

function isInitializedNotification(parsedBody: unknown): boolean {
  return Boolean(
    parsedBody &&
      typeof parsedBody === 'object' &&
      (parsedBody as { method?: unknown }).method === 'notifications/initialized'
  )
}
