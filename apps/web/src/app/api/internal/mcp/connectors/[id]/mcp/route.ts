import { NextRequest, NextResponse } from 'next/server'

import { decryptConfig } from '@/lib/connectors/crypto'
import { verifyConnectorGatewayToken } from '@/lib/connectors/gateway-tokens'
import { isOAuthConnectorType } from '@/lib/connectors/oauth'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { refreshConnectorOAuthConfigIfNeeded } from '@/lib/connectors/oauth-refresh'
import {
  executeZendeskMcpTool,
  getZendeskMcpProtocolVersion,
  getZendeskMcpTools,
  parseZendeskConnectorConfig,
} from '@/lib/connectors/zendesk'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'
import { connectorService } from '@/lib/services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ZENDESK_MCP_SERVER_INFO = {
  name: 'arche-zendesk-connector',
  version: '0.1.0',
}

type JsonRpcId = string | number | null

function toJsonRpcId(value: unknown): JsonRpcId {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function jsonRpcResult(id: JsonRpcId, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  status = 400,
  data?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data ? { data } : {}),
      },
    },
    { status }
  )
}

async function handleZendeskMcp(request: NextRequest, decryptedConfig: Record<string, unknown>): Promise<Response> {
  if (request.method !== 'POST') {
    return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } })
  }

  const parsedConfig = parseZendeskConnectorConfig(decryptedConfig)
  if (!parsedConfig.ok) {
    return jsonRpcError(
      null,
      -32000,
      parsedConfig.message ?? `Invalid Zendesk connector config: ${parsedConfig.missing?.join(', ')}`,
      500
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonRpcError(null, -32700, 'Invalid JSON payload', 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC request', 400)
  }

  const rpc = body as Record<string, unknown>
  const id = toJsonRpcId(rpc.id)
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || !rpc.method.trim()) {
    return jsonRpcError(id, -32600, 'Invalid JSON-RPC request', 400)
  }

  const method = rpc.method
  if (method.startsWith('notifications/')) {
    return new Response(null, { status: 204 })
  }

  switch (method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: getZendeskMcpProtocolVersion(),
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: ZENDESK_MCP_SERVER_INFO,
      })

    case 'ping':
      return jsonRpcResult(id, {})

    case 'tools/list':
      return jsonRpcResult(id, {
        tools: getZendeskMcpTools(),
      })

    case 'resources/list':
      return jsonRpcResult(id, { resources: [] })

    case 'resources/templates/list':
      return jsonRpcResult(id, { resourceTemplates: [] })

    case 'prompts/list':
      return jsonRpcResult(id, { prompts: [] })

    case 'tools/call': {
      const params = rpc.params && typeof rpc.params === 'object' && !Array.isArray(rpc.params)
        ? rpc.params as Record<string, unknown>
        : null
      const toolName = typeof params?.name === 'string' ? params.name : null
      if (!toolName) {
        return jsonRpcError(id, -32602, 'tools/call requires a tool name', 400)
      }

      const result = await executeZendeskMcpTool(parsedConfig.value, toolName, params?.arguments)
      return jsonRpcResult(id, result)
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`, 404)
  }
}

function getUpstreamMcpUrl(
  type: ConnectorType,
  config: Record<string, unknown>,
  oauthMcpServerUrl?: string,
): string | null {
  if (oauthMcpServerUrl) {
    return oauthMcpServerUrl
  }

  if (type === 'linear') {
    return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || 'https://mcp.linear.app/mcp'
  }

  if (type === 'notion') {
    return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || 'https://mcp.notion.com/mcp'
  }

  if (type === 'zendesk') {
    return null
  }

  const endpoint = config.endpoint
  return typeof endpoint === 'string' ? endpoint : null
}

function extractGatewayToken(headers: Headers): string | null {
  const authorization = headers.get('authorization')
  if (!authorization) return null
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

async function handleProxy(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const token = extractGatewayToken(request.headers)

  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: ReturnType<typeof verifyConnectorGatewayToken>
  try {
    payload = verifyConnectorGatewayToken(token)
  } catch {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }

  if (payload.connectorId !== id) {
    return NextResponse.json({ error: 'connector_mismatch' }, { status: 403 })
  }

  const connector = await connectorService.findEnabledByIdAndUserId(id, payload.userId)

  if (!connector) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (connector.userId !== payload.userId) {
    return NextResponse.json({ error: 'stale_token' }, { status: 401 })
  }

  if (!validateConnectorType(connector.type)) {
    return NextResponse.json({ error: 'unsupported_connector' }, { status: 400 })
  }

  const refreshedConfig = await refreshConnectorOAuthConfigIfNeeded(connector)
  const encryptedConfig = refreshedConfig ?? connector.config

  let decryptedConfig: Record<string, unknown>
  try {
    decryptedConfig = decryptConfig(encryptedConfig)
  } catch {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 500 })
  }

  if (connector.type === 'zendesk') {
    return handleZendeskMcp(request, decryptedConfig)
  }

  if (!isOAuthConnectorType(connector.type)) {
    return NextResponse.json({ error: 'unsupported_connector' }, { status: 400 })
  }

  if (getConnectorAuthType(decryptedConfig) !== 'oauth') {
    return NextResponse.json({ error: 'oauth_required' }, { status: 409 })
  }

  const oauth = getConnectorOAuthConfig(connector.type, decryptedConfig)
  if (!oauth?.accessToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const upstreamUrl = getUpstreamMcpUrl(connector.type, decryptedConfig, oauth.mcpServerUrl)
  if (!upstreamUrl) {
    return NextResponse.json({ error: 'invalid_connector_endpoint' }, { status: 400 })
  }

  let upstream: URL
  if (connector.type === 'custom') {
    const endpointValidation = await validateConnectorTestEndpoint(upstreamUrl)
    if (!endpointValidation.ok) {
      return NextResponse.json({ error: 'invalid_connector_endpoint' }, { status: 400 })
    }
    upstream = endpointValidation.url
  } else {
    try {
      upstream = new URL(upstreamUrl)
    } catch {
      return NextResponse.json({ error: 'invalid_connector_endpoint' }, { status: 400 })
    }
  }

  upstream.search = new URL(request.url).search

  const headers = new Headers(request.headers)
  headers.delete('authorization')
  headers.delete('host')
  headers.delete('content-length')
  headers.set('accept-encoding', 'identity')
  headers.set('authorization', `Bearer ${oauth.accessToken}`)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
  }
  if (hasBody) {
    init.body = request.body
    init.duplex = 'half'
  }

  const upstreamResponse = await fetch(upstream.toString(), init)
  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleProxy(request, context)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleProxy(request, context)
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleProxy(request, context)
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleProxy(request, context)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleProxy(request, context)
}
