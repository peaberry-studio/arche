import { NextRequest, NextResponse } from 'next/server'

import { decryptConfig } from '@/lib/connectors/crypto'
import { verifyConnectorGatewayToken } from '@/lib/connectors/gateway-tokens'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { refreshConnectorOAuthConfigIfNeeded } from '@/lib/connectors/oauth-refresh'
import { validateConnectorType } from '@/lib/connectors/validators'
import { connectorService } from '@/lib/services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getUpstreamMcpUrl(type: 'linear' | 'notion'): string {
  if (type === 'linear') {
    return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || 'https://mcp.linear.app/mcp'
  }
  return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || 'https://mcp.notion.com/mcp'
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

  if (!validateConnectorType(connector.type) || (connector.type !== 'linear' && connector.type !== 'notion')) {
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

  if (getConnectorAuthType(decryptedConfig) !== 'oauth') {
    return NextResponse.json({ error: 'oauth_required' }, { status: 409 })
  }

  const oauth = getConnectorOAuthConfig(connector.type, decryptedConfig)
  if (!oauth?.accessToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const upstream = new URL(getUpstreamMcpUrl(connector.type))
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
