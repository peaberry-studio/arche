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
const MCP_MAX_BODY_BYTES = 64 * 1024

export async function POST(request: Request): Promise<Response> {
  if (isRequestBodyTooLarge(request.headers)) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const mcpSettings = await readMcpSettings()
  if (!mcpSettings.ok || !mcpSettings.enabled) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const auth = await authenticatePat(request)
  if (!auth.ok) {
    return Response.json({ error: 'unauthorized' }, { status: auth.status })
  }

  const rateLimit = checkRateLimit(`mcp:${auth.tokenId}`, MCP_RATE_LIMIT_MAX, MCP_RATE_LIMIT_WINDOW_MS)
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
        },
      }
    )
  }

  const rawBody = await request.text().catch(() => null)
  const parsedBody = parseBody(rawBody)
  if (!parsedBody) {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (parsedBody.tooLarge) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
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
      ip: getClientIp(request.headers) ?? 'unknown',
      method: getRequestMethod(parsedBody.value),
      tokenId: auth.tokenId,
      toolName: getToolName(parsedBody.value),
    },
  })

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  })
  const server = createMcpServer()
  const forwardedRequest = buildTransportRequest(request, rawBody)

  await server.connect(transport)
  return transport.handleRequest(forwardedRequest, { parsedBody: parsedBody.value })
}

function isRequestBodyTooLarge(headers: Headers): boolean {
  const contentLength = Number.parseInt(headers.get('content-length') ?? '', 10)
  return Number.isFinite(contentLength) && contentLength > MCP_MAX_BODY_BYTES
}

function parseBody(bodyText: string | null): { tooLarge: boolean; value: unknown } | null {
  if (bodyText === null) return null
  if (Buffer.byteLength(bodyText, 'utf8') > MCP_MAX_BODY_BYTES) {
    return { tooLarge: true, value: null }
  }

  try {
    return {
      tooLarge: false,
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
