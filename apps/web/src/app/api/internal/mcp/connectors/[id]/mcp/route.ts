import { NextRequest, NextResponse } from 'next/server'

import { decryptConfig } from '@/lib/connectors/crypto'
import { verifyConnectorGatewayToken } from '@/lib/connectors/gateway-tokens'
import { proxyConnectorMcpRequest } from '@/lib/connectors/mcp/remote-proxy'
import { handleZendeskMcpRequest } from '@/lib/connectors/mcp/zendesk-handler'
import { isOAuthConnectorType } from '@/lib/connectors/oauth'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { refreshConnectorOAuthConfigIfNeeded } from '@/lib/connectors/oauth-refresh'
import { validateConnectorType } from '@/lib/connectors/validators'
import { connectorService } from '@/lib/services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    return handleZendeskMcpRequest(request, decryptedConfig)
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

  return proxyConnectorMcpRequest({
    request,
    type: connector.type,
    config: decryptedConfig,
    accessToken: oauth.accessToken,
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
