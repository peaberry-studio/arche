import { NextRequest, NextResponse } from 'next/server'

import { getSession } from '@/lib/runtime/session'
import { decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { refreshConnectorOAuthConfigIfNeeded } from '@/lib/connectors/oauth-refresh'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import { validateSameOrigin } from '@/lib/csrf'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'
import { connectorService, userService } from '@/lib/services'

export interface TestConnectionResult {
  ok: boolean
  tested: boolean
  message?: string
}

const MCP_SERVER_URLS = {
  linear: 'https://mcp.linear.app/mcp',
  notion: 'https://mcp.notion.com/mcp',
} as const

const MCP_PROTOCOL_VERSION = '2025-03-26'

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

function getAccessToken(type: ConnectorType, config: Record<string, unknown>): string | null {
  if (getConnectorAuthType(config) === 'oauth') {
    const oauth = getConnectorOAuthConfig(type, config)
    return oauth?.accessToken ?? null
  }

  switch (type) {
    case 'linear':
    case 'notion':
      return typeof config.apiKey === 'string' ? config.apiKey : null
    case 'custom':
      return null
  }
}

function isOAuthPending(type: ConnectorType, config: Record<string, unknown>): boolean {
  if (getConnectorAuthType(config) !== 'oauth') return false
  if (type !== 'linear' && type !== 'notion') return false
  return !getConnectorOAuthConfig(type, config)?.accessToken
}

function getMcpServerUrl(type: 'linear' | 'notion', config: Record<string, unknown>): string {
  const oauth = getConnectorOAuthConfig(type, config)
  if (oauth?.mcpServerUrl) return oauth.mcpServerUrl

  if (type === 'linear') {
    return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || MCP_SERVER_URLS.linear
  }
  return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || MCP_SERVER_URLS.notion
}

function buildMcpInitializeBody() {
  return {
    jsonrpc: '2.0',
    id: 'arche-connector-test',
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: {
        name: 'arche-web',
        version: '0.1.0',
      },
      capabilities: {},
    },
  }
}

async function testRemoteMcpConnection(input: {
  label: 'Linear' | 'Notion'
  url: string
  token: string
}): Promise<TestConnectionResult> {
  const response = await fetchWithTimeout(input.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(buildMcpInitializeBody()),
  })

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      tested: true,
      message: `${input.label} MCP authentication failed (${response.status}). Reconnect OAuth and retry.`,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      tested: true,
      message: `${input.label} MCP test failed (${response.status})`,
    }
  }

  return {
    ok: true,
    tested: true,
    message: `${input.label} MCP connection verified.`,
  }
}

async function testConnection(
  type: ConnectorType,
  config: Record<string, unknown>,
  options: { customEndpointUrl?: URL } = {}
): Promise<TestConnectionResult> {
  try {
    switch (type) {
      case 'notion': {
        if (isOAuthPending(type, config)) {
          return {
            ok: false,
            tested: false,
            message: 'Complete OAuth from the dashboard before testing this connector.',
          }
        }

        if (getConnectorAuthType(config) === 'oauth') {
          const token = getAccessToken(type, config)
          if (!token) return { ok: false, tested: false, message: 'Missing OAuth access token' }

          return testRemoteMcpConnection({
            label: 'Notion',
            url: getMcpServerUrl(type, config),
            token,
          })
        }

        const token = getAccessToken(type, config)
        if (!token) return { ok: false, tested: false, message: 'Missing API key' }

        const response = await fetchWithTimeout('https://api.notion.com/v1/users/me', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
          },
        })
        if (!response.ok) {
          return { ok: false, tested: true, message: `Notion test failed (${response.status})` }
        }
        return { ok: true, tested: true, message: 'Notion connection verified.' }
      }

      case 'linear': {
        if (isOAuthPending(type, config)) {
          return {
            ok: false,
            tested: false,
            message: 'Complete OAuth from the dashboard before testing this connector.',
          }
        }

        const token = getAccessToken(type, config)
        if (!token) return { ok: false, tested: false, message: 'Missing API key' }

        return testRemoteMcpConnection({
          label: 'Linear',
          url: getMcpServerUrl(type, config),
          token,
        })
      }

      case 'custom': {
        const endpoint = typeof config.endpoint === 'string' ? config.endpoint : ''
        if (!endpoint) {
          return { ok: false, tested: false, message: 'Missing endpoint' }
        }

        const headers: Record<string, string> = {
          Accept: 'application/json',
        }
        const auth = typeof config.auth === 'string' ? config.auth : ''
        if (auth) {
          headers.Authorization = `Bearer ${auth}`
        }

        const response = await fetchWithTimeout(options.customEndpointUrl ?? endpoint, {
          method: 'GET',
          headers,
          redirect: 'manual',
        })

        if (!response.ok) {
          return { ok: false, tested: true, message: `Custom endpoint test failed (${response.status})` }
        }
        return { ok: true, tested: true, message: 'Custom endpoint reachable.' }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed'
    return { ok: false, tested: true, message }
  }

  return { ok: false, tested: false, message: `Unknown connector type: ${type}` }
}

/**
 * POST /api/u/[slug]/connectors/[id]/test
 *
 * Tests connector connectivity.
 *
 * Response: { ok: boolean, tested: boolean, message?: string }
 *
 * Status codes:
 * - 200: Test executed (`ok` indicates success, `tested` indicates test was actually run)
 * - 401: Not authenticated
 * - 403: Not authorized
 * - 404: User or connector not found
 * - 409: Connector disabled
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<TestConnectionResult | { error: string }>> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug, id } = await params

  // Verify authorization
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Get user
  const user = await userService.findIdBySlug(slug)

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // Get connector while verifying ownership
  const connector = await connectorService.findByIdAndUserId(id, user.id)

  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Verify connector is enabled
  if (!connector.enabled) {
    return NextResponse.json({ error: 'connector_disabled' }, { status: 409 })
  }

  // Decrypt config and test connection
  const refreshedConfig = await refreshConnectorOAuthConfigIfNeeded({
    id: connector.id,
    type: connector.type,
    config: connector.config,
  })

  let config: Record<string, unknown>
  try {
    config = decryptConfig(refreshedConfig ?? connector.config)
  } catch {
    return NextResponse.json(
      { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
      { status: 500 }
    )
  }

  if (!validateConnectorType(connector.type)) {
    return NextResponse.json({ error: 'unsupported_connector_type' }, { status: 400 })
  }

  let customEndpointUrl: URL | undefined
  if (connector.type === 'custom') {
    const endpoint = typeof config.endpoint === 'string' ? config.endpoint : ''
    if (endpoint) {
      const endpointValidation = await validateConnectorTestEndpoint(endpoint)
      if (!endpointValidation.ok) {
        return NextResponse.json({ error: endpointValidation.error }, { status: 400 })
      }
      customEndpointUrl = endpointValidation.url
    }
  }

  const result = await testConnection(connector.type, config, { customEndpointUrl })

  if (result.ok && getConnectorAuthType(config) === 'oauth') {
    const message = result.message ?? 'Connection verified.'
    return NextResponse.json({
      ...result,
      message:
        `${message} Restart the workspace to apply the updated connector credentials. ` +
        'If it is still unavailable in chat, enable this connector in Agent capabilities.',
    })
  }

  return NextResponse.json(result)
}
