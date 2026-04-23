import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig } from '@/lib/connectors/crypto'
import {
  isOAuthConnectorType,
  normalizeConnectorOAuthReturnTo,
  prepareConnectorOAuthAuthorization,
} from '@/lib/connectors/oauth'
import type { OAuthConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import { getPublicBaseUrl } from '@/lib/http'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { connectorService, userService } from '@/lib/services'

type StartOAuthResponse = {
  authorizeUrl: string
}

function requiresConnectorConfig(type: OAuthConnectorType): boolean {
  return type === 'linear' || type === 'custom'
}

export const POST = withAuth<
  StartOAuthResponse | { error: string; message?: string },
  { slug: string; id: string }
>({ csrf: true }, async (request: NextRequest, { user: actorUser, slug, params: { id } }) => {
  const denied = requireCapability('connectors')
  if (denied) return denied

  const targetUser = await userService.findIdBySlug(slug)

  if (!targetUser) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  const connector = await connectorService.findByIdAndUserIdSelect(id, targetUser.id, {
    id: true,
    type: true,
    config: true,
  })
  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  if (!validateConnectorType(connector.type) || !isOAuthConnectorType(connector.type)) {
    return NextResponse.json({ error: 'oauth_not_supported' }, { status: 400 })
  }

  const baseUrl = getPublicBaseUrl(request.headers, request.nextUrl.origin)
  const redirectUri = `${baseUrl}/api/connectors/oauth/callback`
  const returnTo = normalizeConnectorOAuthReturnTo(request.nextUrl.searchParams.get('returnTo'))

  let connectorConfig: Record<string, unknown> | undefined
  if (requiresConnectorConfig(connector.type)) {
    try {
      connectorConfig = decryptConfig(connector.config)
    } catch {
      return NextResponse.json(
        { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
        { status: 500 }
      )
    }
  }

  let authorizeUrl: string
  try {
    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: connector.id,
      slug,
      returnTo,
      userId: targetUser.id,
      connectorType: connector.type,
      redirectUri,
      connectorConfig,
    })
    authorizeUrl = prepared.authorizeUrl
  } catch (error) {
    const message = error instanceof Error ? error.message : 'oauth_start_failed'
    if (
      message === 'missing_endpoint'
      || message === 'missing_linear_oauth_client_credentials'
      || message === 'invalid_endpoint'
      || message === 'blocked_endpoint'
      || message === 'oauth_state_too_large'
    ) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    if (message.startsWith('oauth_discovery_failed')) {
      return NextResponse.json(
        {
          error: 'oauth_discovery_failed',
          message: 'Failed to discover OAuth endpoints for this MCP server.',
        },
        { status: 502 }
      )
    }

    if (message.startsWith('oauth_registration_failed')) {
      return NextResponse.json(
        {
          error: 'oauth_registration_failed',
          message: 'Dynamic client registration failed for this MCP server.',
        },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }

  await auditEvent({
    actorUserId: actorUser.id,
    action: 'connector.oauth_started',
    metadata: { connectorId: connector.id, connectorType: connector.type },
  })

  return NextResponse.json({ authorizeUrl })
})
