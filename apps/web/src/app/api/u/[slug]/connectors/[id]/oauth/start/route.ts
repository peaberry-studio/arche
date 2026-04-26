import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig } from '@/lib/connectors/crypto'
import { isGoogleWorkspaceConnectorType } from '@/lib/connectors/google-workspace'
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
import { connectorService, googleWorkspaceService, userService } from '@/lib/services'

type StartOAuthResponse = {
  authorizeUrl: string
}

function requiresConnectorConfig(type: OAuthConnectorType): boolean {
  return type === 'linear' || type === 'custom' || type === 'meta-ads'
}

type ResolveOAuthStartConnectorConfigResult =
  | { ok: true; config: Record<string, unknown> | undefined }
  | { ok: false; error: 'config_corrupted' }

async function resolveOAuthStartConnectorConfig(
  type: OAuthConnectorType,
  encryptedConfig: string,
): Promise<ResolveOAuthStartConnectorConfigResult> {
  let config: Record<string, unknown> | undefined

  if (requiresConnectorConfig(type)) {
    try {
      config = decryptConfig(encryptedConfig)
    } catch {
      return { ok: false, error: 'config_corrupted' }
    }
  }

  // Admin-managed Google Workspace credentials intentionally override any per-connector values.
  if (isGoogleWorkspaceConnectorType(type)) {
    const googleCredentials = await googleWorkspaceService.getResolvedCredentials()
    if (googleCredentials) {
      config = {
        ...config,
        clientId: googleCredentials.clientId,
        clientSecret: googleCredentials.clientSecret,
      }
    }
  }

  return { ok: true, config }
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

  if (connector.type === 'meta-ads') {
    const denied = requireCapability('metaAdsConnector')
    if (denied) return denied
  }

  const baseUrl = getPublicBaseUrl(request.headers, request.nextUrl.origin)
  const redirectUri = `${baseUrl}/api/connectors/oauth/callback`
  const returnTo = normalizeConnectorOAuthReturnTo(request.nextUrl.searchParams.get('returnTo'))

  const resolved = await resolveOAuthStartConnectorConfig(connector.type, connector.config)
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error, message: 'Failed to decrypt connector configuration' },
      { status: 500 },
    )
  }
  const connectorConfig = resolved.config

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
      || message === 'missing_google_oauth_client_credentials'
      || message === 'invalid_endpoint'
      || message === 'blocked_endpoint'
      || message === 'oauth_state_too_large'
      || message === 'meta_ads_missing_app_id'
      || message === 'meta_ads_missing_app_secret'
    ) {
      const errorPayload = message.startsWith('meta_ads_missing_')
        ? {
            error: message,
            message: message === 'meta_ads_missing_app_id'
              ? 'Meta Ads App ID is required before connecting OAuth.'
              : 'Meta Ads App Secret is required before connecting OAuth.',
          }
        : { error: message }

      return NextResponse.json(errorPayload, { status: 400 })
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
