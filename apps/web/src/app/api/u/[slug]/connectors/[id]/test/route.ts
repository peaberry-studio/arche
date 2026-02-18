import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import { validateSameOrigin } from '@/lib/csrf'
import { prisma } from '@/lib/prisma'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'

export interface TestConnectionResult {
  ok: boolean
  tested: boolean
  message?: string
}

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

        const response = await fetchWithTimeout('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: '{ viewer { id } }' }),
        })

        const body = (await response.json().catch(() => null)) as
          | { data?: { viewer?: { id?: string } }; errors?: Array<{ message?: string }> }
          | null

        if (!response.ok || !body?.data?.viewer?.id) {
          return {
            ok: false,
            tested: true,
            message: `Linear test failed (${body?.errors?.[0]?.message ?? response.status})`,
          }
        }
        return { ok: true, tested: true, message: 'Linear connection verified.' }
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
  const session = await getAuthenticatedUser()
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
  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // Get connector while verifying ownership
  const connector = await prisma.connector.findFirst({
    where: { id, userId: user.id },
  })

  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Verify connector is enabled
  if (!connector.enabled) {
    return NextResponse.json({ error: 'connector_disabled' }, { status: 409 })
  }

  // Decrypt config and test connection
  let config: Record<string, unknown>
  try {
    config = decryptConfig(connector.config)
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

  return NextResponse.json(result)
}
