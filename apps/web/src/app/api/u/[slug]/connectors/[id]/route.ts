import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { resolveLinearOAuthActor, type LinearOAuthActor } from '@/lib/connectors/linear'
import {
  getConnectorAuthType,
  getConnectorOAuthConfig,
  mergeConnectorConfigWithPreservedOAuth,
} from '@/lib/connectors/oauth-config'
import { requireConnectorCapability } from '@/lib/connectors/require-connector-capability'
import { sanitizeConnectorConfigForResponse } from '@/lib/connectors/response-config'
import { preserveConnectorToolPermissions } from '@/lib/connectors/tool-permissions'
import type { ConnectorType } from '@/lib/connectors/types'
import {
  validateConnectorConfig,
  validateConnectorName,
  validateConnectorType,
} from '@/lib/connectors/validators'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { connectorService, userService } from '@/lib/services'

export interface ConnectorDetail {
  id: string
  type: string
  name: string
  config: Record<string, unknown>
  enabled: boolean
  authType: 'manual' | 'oauth'
  oauthActor?: LinearOAuthActor
  oauthConnected: boolean
  oauthExpiresAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * GET /api/u/[slug]/connectors/[id]
 *
 * Returns a single connector WITH decrypted config (for editing).
 *
 * Response: ConnectorDetail
 *
 * Status codes:
 * - 200: Connector found
 * - 401: Not authenticated
 * - 403: Not authorized
 * - 404: User or connector not found
 */
export const GET = withAuth<ConnectorDetail | { error: string }, { slug: string; id: string }>(
  { csrf: false },
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

    const connectorDenied = requireConnectorCapability(connector.type)
    if (connectorDenied) return connectorDenied

    let config: Record<string, unknown>
    try {
      config = decryptConfig(connector.config)
    } catch {
      return NextResponse.json(
        { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      id: connector.id,
      type: connector.type,
      name: connector.name,
      config: validateConnectorType(connector.type) ? sanitizeConnectorConfigForResponse(connector.type, config) : config,
      enabled: connector.enabled,
      authType: getConnectorAuthType(config),
      oauthActor: resolveLinearOAuthActor(connector.type, getConnectorAuthType(config), config),
      oauthConnected: validateConnectorType(connector.type)
        ? Boolean(getConnectorOAuthConfig(connector.type, config)?.accessToken)
        : false,
      oauthExpiresAt: validateConnectorType(connector.type)
        ? getConnectorOAuthConfig(connector.type, config)?.expiresAt
        : undefined,
      createdAt: connector.createdAt.toISOString(),
      updatedAt: connector.updatedAt.toISOString(),
    })
  },
)

export interface UpdateConnectorRequest {
  name?: string
  config?: Record<string, unknown>
  enabled?: boolean
}

/**
 * PATCH /api/u/[slug]/connectors/[id]
 *
 * Updates a connector.
 *
 * Request: { name?, config?, enabled? }
 * Response: ConnectorDetail
 *
 * Status codes:
 * - 200: Connector updated
 * - 400: Validation failed
 * - 401: Not authenticated
 * - 403: Not authorized
 * - 404: User or connector not found
 */
export const PATCH = withAuth<
  ConnectorDetail | { error: string; message?: string },
  { slug: string; id: string }
>({ csrf: true }, async (request: NextRequest, { user, slug, params: { id } }) => {
  const denied = requireCapability('connectors')
  if (denied) return denied

  const targetUser = await userService.findIdBySlug(slug)

  if (!targetUser) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  const existingConnector = await connectorService.findByIdAndUserId(id, targetUser.id)

  if (!existingConnector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  const connectorDenied = requireConnectorCapability(existingConnector.type)
  if (connectorDenied) return connectorDenied

  // Parse request body
  let body: UpdateConnectorRequest
  try {
    body = await request.json()
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    throw err
  }

  // Validate body is an object
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be a JSON object' },
      { status: 400 }
    )
  }

  const { name, config, enabled } = body

  // Prepare data to update
  const updateData: { name?: string; config?: string; enabled?: boolean } = {}
  let responseConfig: Record<string, unknown> | null = null

  if (name !== undefined) {
    const nameValidation = validateConnectorName(name)
    if (!nameValidation.valid) {
      return NextResponse.json(
        { error: 'invalid_name', message: nameValidation.error },
        { status: 400 }
      )
    }
    updateData.name = (name as string).trim()
  }

  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'invalid_enabled', message: 'enabled must be a boolean' },
        { status: 400 }
      )
    }
    updateData.enabled = enabled
  }

  let existingDecryptedConfig: Record<string, unknown>
  try {
    existingDecryptedConfig = decryptConfig(existingConnector.config)
  } catch {
    return NextResponse.json(
      { error: 'config_corrupted', message: 'Existing connector configuration is corrupted' },
      { status: 500 }
    )
  }

  if (config !== undefined) {
    // Validate config is a non-null object
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      return NextResponse.json(
        { error: 'invalid_config', message: 'config must be a non-null object' },
        { status: 400 }
      )
    }
    // Validate connector type (defense against corrupted data)
    if (!validateConnectorType(existingConnector.type)) {
      return NextResponse.json(
        { error: 'invalid_connector_type', message: 'Connector has invalid type in database' },
        { status: 500 }
      )
    }
    const connectorType = existingConnector.type as ConnectorType
    const configWithToolPermissions = preserveConnectorToolPermissions(existingDecryptedConfig, config)
    const mergedConfig = mergeConnectorConfigWithPreservedOAuth({
      connectorType,
      currentConfig: existingDecryptedConfig,
      nextConfig: configWithToolPermissions,
    })
    const configValidation = validateConnectorConfig(connectorType, mergedConfig)
    if (!configValidation.valid) {
      return NextResponse.json(
        {
          error: 'invalid_config',
          message: configValidation.message ?? `Missing required fields: ${configValidation.missing?.join(', ')}`,
        },
        { status: 400 }
      )
    }
    try {
      updateData.config = encryptConfig(mergedConfig)
      responseConfig = mergedConfig
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to encrypt config'
      return NextResponse.json(
        { error: 'invalid_config', message },
        { status: 400 }
      )
    }
  }

  // Validate at least one field was provided for update
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: 'no_fields', message: 'At least one field (name, config, enabled) must be provided' },
      { status: 400 }
    )
  }

  if (responseConfig === null) {
    responseConfig = existingDecryptedConfig
  }

  const resolvedResponseConfig = responseConfig ?? existingDecryptedConfig

  // Update connector atomically while verifying ownership (prevents TOCTOU)
  const result = await connectorService.updateManyByIdAndUserId(id, targetUser.id, updateData)

  if (result.count === 0) {
    // Ownership changed concurrently or connector was deleted
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Get updated connector for response
  const connector = await connectorService.findById(id)

  // Defensive check (shouldn't happen given updateMany succeeded)
  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Audit log
  await auditEvent({
    actorUserId: user.id,
    action: 'connector.updated',
    metadata: { connectorId: connector.id, fields: Object.keys(updateData) },
  })

  const connectorType = validateConnectorType(connector.type) ? connector.type : null
  const authType = getConnectorAuthType(resolvedResponseConfig)
  const oauthConfig = connectorType ? getConnectorOAuthConfig(connectorType, resolvedResponseConfig) : null

  return NextResponse.json({
    id: connector.id,
    type: connector.type,
    name: connector.name,
    config: connectorType ? sanitizeConnectorConfigForResponse(connectorType, resolvedResponseConfig) : resolvedResponseConfig,
    enabled: connector.enabled,
    authType,
    oauthActor: connectorType ? resolveLinearOAuthActor(connectorType, authType, resolvedResponseConfig) : undefined,
    oauthConnected: Boolean(oauthConfig?.accessToken),
    oauthExpiresAt: oauthConfig?.expiresAt,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
  })
})

/**
 * DELETE /api/u/[slug]/connectors/[id]
 *
 * Deletes a connector.
 *
 * Response: { ok: true }
 *
 * Status codes:
 * - 200: Connector deleted
 * - 401: Not authenticated
 * - 403: Not authorized
 * - 404: User or connector not found
 */
export const DELETE = withAuth<{ ok: true } | { error: string }, { slug: string; id: string }>(
  { csrf: true },
  async (_request: NextRequest, { user, slug, params: { id } }) => {
    const denied = requireCapability('connectors')
    if (denied) return denied

    const targetUser = await userService.findIdBySlug(slug)

    if (!targetUser) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const result = await connectorService.deleteManyByIdAndUserId(id, targetUser.id)

    if (result.count === 0) {
      return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'connector.deleted',
      metadata: { connectorId: id },
    })

    return NextResponse.json({ ok: true })
  },
)
