import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { resolveLinearOAuthActor, type LinearOAuthActor } from '@/lib/connectors/linear'
import { getConnectorListStatus } from '@/lib/connectors/list-status'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import {
  isConnectorCapabilityAvailable,
  requireConnectorCapability,
} from '@/lib/connectors/require-connector-capability'
import { isSingleInstanceConnectorType } from '@/lib/connectors/types'
import {
  validateConnectorType,
  validateConnectorConfig,
  validateConnectorName,
} from '@/lib/connectors/validators'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { connectorService, userService } from '@/lib/services'

export interface ConnectorListItem {
  id: string
  type: string
  name: string
  enabled: boolean
  status: 'ready' | 'pending' | 'disabled'
  authType: 'manual' | 'oauth'
  oauthActor?: LinearOAuthActor
  oauthConnected: boolean
  oauthExpiresAt?: string
  createdAt: string
}

/**
 * GET /api/u/[slug]/connectors
 *
 * Lists user connectors (without config/credentials).
 *
 * Response: { connectors: ConnectorListItem[] }
 *
 * Status codes:
 * - 200: Connector list
 * - 401: Not authenticated
 * - 403: Not authorized (different user)
 * - 404: User not found
 */
export const GET = withAuth<{ connectors: ConnectorListItem[] } | { error: string }>(
  { csrf: false },
  async (_request: NextRequest, { slug }) => {
    const denied = requireCapability('connectors')
    if (denied) return denied

    const user = await userService.findIdBySlug(slug)

    if (!user) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const connectors = await connectorService.findManyByUserId(user.id)

    return NextResponse.json({
      connectors: connectors
        .filter((c) => validateConnectorType(c.type))
        .filter((c) => isConnectorCapabilityAvailable(c.type))
        .map((c) => {
          let authType: 'manual' | 'oauth' = 'manual'
          let oauthActor: LinearOAuthActor | undefined
          let oauthConnected = false
          let oauthExpiresAt: string | undefined
          let config: Record<string, unknown> = {}

          try {
            config = decryptConfig(c.config)
            authType = getConnectorAuthType(config)
            oauthActor = resolveLinearOAuthActor(c.type, authType, config)
            const oauth = validateConnectorType(c.type) ? getConnectorOAuthConfig(c.type, config) : null
            oauthConnected = Boolean(oauth?.accessToken)
            oauthExpiresAt = oauth?.expiresAt
          } catch {
            authType = 'manual'
          }

          return {
            id: c.id,
            type: c.type,
            name: c.name,
            enabled: c.enabled,
            status: getConnectorListStatus({
              type: c.type,
              enabled: c.enabled,
              authType,
              oauthConnected,
              config,
            }),
            authType,
            oauthActor,
            oauthConnected,
            oauthExpiresAt,
            createdAt: c.createdAt.toISOString(),
          }
        }),
    })
  },
)

export interface CreateConnectorRequest {
  type: string
  name: string
  config: Record<string, unknown>
}

export interface ConnectorResponse {
  id: string
  type: string
  name: string
  enabled: boolean
  createdAt: string
}

/**
 * POST /api/u/[slug]/connectors
 *
 * Creates a new connector.
 *
 * Request: { type, name, config }
 * Response: { id, type, name, enabled, createdAt }
 *
 * Status codes:
 * - 201: Connector created
 * - 400: Validation failed (invalid type, missing fields)
 * - 401: Not authenticated
 * - 403: Not authorized
 * - 404: User not found
 */
export const POST = withAuth<ConnectorResponse | { error: string; message?: string }>(
  { csrf: true },
  async (request: NextRequest, { user, slug }) => {
    const denied = requireCapability('connectors')
    if (denied) return denied

    const targetUser = await userService.findIdBySlug(slug)

    if (!targetUser) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    let body: CreateConnectorRequest
    try {
      body = await request.json()
    } catch (err) {
      if (err instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw err
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Request body must be a JSON object' },
        { status: 400 }
      )
    }

    const { type, name, config } = body

    if (!type || !name || !config) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'type, name, and config are required' },
        { status: 400 }
      )
    }

    if (typeof config !== 'object' || Array.isArray(config)) {
      return NextResponse.json(
        { error: 'invalid_config', message: 'config must be a non-null object' },
        { status: 400 }
      )
    }

    const nameValidation = validateConnectorName(name)
    if (!nameValidation.valid) {
      return NextResponse.json(
        { error: 'invalid_name', message: nameValidation.error },
        { status: 400 }
      )
    }

    if (!validateConnectorType(type)) {
      return NextResponse.json(
        { error: 'invalid_type', message: `Invalid connector type: ${type}` },
        { status: 400 }
      )
    }

    const connectorDenied = requireConnectorCapability(type)
    if (connectorDenied) return connectorDenied

    const configValidation = validateConnectorConfig(type, config)
    if (!configValidation.valid) {
      return NextResponse.json(
        {
          error: 'invalid_config',
          message: configValidation.message ?? `Missing required fields: ${configValidation.missing?.join(', ')}`,
        },
        { status: 400 }
      )
    }

    if (isSingleInstanceConnectorType(type)) {
      const existing = await connectorService.findFirstByUserIdAndType(targetUser.id, type)

      if (existing) {
        return NextResponse.json(
          {
            error: 'connector_already_exists',
            message: `${type} connector already exists for this workspace`,
          },
          { status: 409 }
        )
      }
    }

    let encryptedConfig: string
    try {
      encryptedConfig = encryptConfig(config)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to encrypt config'
      return NextResponse.json(
        { error: 'invalid_config', message },
        { status: 400 }
      )
    }

    const connector = await connectorService.create({
      userId: targetUser.id,
      type,
      name: name.trim(),
      config: encryptedConfig,
      enabled: true,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'connector.created',
      metadata: { connectorId: connector.id, type: connector.type },
    })

    return NextResponse.json(
      {
        id: connector.id,
        type: connector.type,
        name: connector.name,
        enabled: connector.enabled,
        createdAt: connector.createdAt.toISOString(),
      },
      { status: 201 }
    )
  },
)
