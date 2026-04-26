import { NextRequest, NextResponse } from 'next/server'

import { decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorAuthType } from '@/lib/connectors/oauth-config'
import { refreshConnectorOAuthConfigIfNeeded } from '@/lib/connectors/oauth-refresh'
import { getCustomConnectorTestEndpoint, testConnectorConnection, type TestConnectionResult } from '@/lib/connectors/test-connection'
import { validateConnectorType } from '@/lib/connectors/validators'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'
import { connectorService, userService } from '@/lib/services'

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
export const POST = withAuth<TestConnectionResult | { error: string }, { slug: string; id: string }>(
  { csrf: true },
  async (_request: NextRequest, { slug, params: { id } }) => {
    const denied = requireCapability('connectors')
    if (denied) return denied

    const user = await userService.findIdBySlug(slug)

    if (!user) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const connector = await connectorService.findByIdAndUserId(id, user.id)

    if (!connector) {
      return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
    }

    if (!connector.enabled) {
      return NextResponse.json({ error: 'connector_disabled' }, { status: 409 })
    }

    if (!validateConnectorType(connector.type)) {
      return NextResponse.json({ error: 'unsupported_connector_type' }, { status: 400 })
    }

    if (connector.type === 'meta-ads') {
      const denied = requireCapability('metaAdsConnector')
      if (denied) return denied
    }

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

    let customEndpointUrl: URL | undefined
    if (connector.type === 'custom') {
      const endpoint = getCustomConnectorTestEndpoint(config) ?? ''

      if (endpoint) {
        const endpointValidation = await validateConnectorTestEndpoint(endpoint)
        if (!endpointValidation.ok) {
          return NextResponse.json({ error: endpointValidation.error }, { status: 400 })
        }
        customEndpointUrl = endpointValidation.url
      }
    }

    const result = await testConnectorConnection(connector.type, config, { customEndpointUrl })

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
  },
)
