import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import {
  validateConnectorType,
  validateConnectorConfig,
  validateConnectorName,
} from '@/lib/connectors/validators'
import { validateSameOrigin } from '@/lib/csrf'
import { getSession } from '@/lib/runtime/session'
import { connectorService, userService } from '@/lib/services'

export interface ConnectorListItem {
  id: string
  type: string
  name: string
  enabled: boolean
  status: 'ready' | 'pending' | 'disabled'
  authType: 'manual' | 'oauth'
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
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<{ connectors: ConnectorListItem[] } | { error: string }>> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params

  // Verify authorization: owner OR ADMIN
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Get user by slug
  const user = await userService.findIdBySlug(slug)

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // List connectors (without config)
  const connectors = await connectorService.findManyByUserId(user.id)

  return NextResponse.json({
    connectors: connectors.filter((c) => validateConnectorType(c.type)).map((c) => {
      let authType: 'manual' | 'oauth' = 'manual'
      let oauthConnected = false
      let oauthExpiresAt: string | undefined

      try {
        const config = decryptConfig(c.config)
        authType = getConnectorAuthType(config)
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
        status: !c.enabled ? 'disabled' : authType === 'oauth' && !oauthConnected ? 'pending' : 'ready',
        authType,
        oauthConnected,
        oauthExpiresAt,
        createdAt: c.createdAt.toISOString(),
      }
    }),
  })
}

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
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<ConnectorResponse | { error: string; message?: string }>> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug } = await params

  // Verify authorization
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Get user
  const user = await userService.findIdBySlug(slug)

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // Parse request body
  let body: CreateConnectorRequest
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

  const { type, name, config } = body

  // Validate required fields
  if (!type || !name || !config) {
    return NextResponse.json(
      { error: 'missing_fields', message: 'type, name, and config are required' },
      { status: 400 }
    )
  }

  // Validate config is a non-null object
  if (typeof config !== 'object' || Array.isArray(config)) {
    return NextResponse.json(
      { error: 'invalid_config', message: 'config must be a non-null object' },
      { status: 400 }
    )
  }

  // Validate name
  const nameValidation = validateConnectorName(name)
  if (!nameValidation.valid) {
    return NextResponse.json(
      { error: 'invalid_name', message: nameValidation.error },
      { status: 400 }
    )
  }

  // Validate connector type
  if (!validateConnectorType(type)) {
    return NextResponse.json(
      { error: 'invalid_type', message: `Invalid connector type: ${type}` },
      { status: 400 }
    )
  }

  // Validate config by connector type
  const configValidation = validateConnectorConfig(type, config)
  if (!configValidation.valid) {
    return NextResponse.json(
      {
        error: 'invalid_config',
        message: `Missing required fields: ${configValidation.missing?.join(', ')}`,
      },
      { status: 400 }
    )
  }

  if (type === 'linear' || type === 'notion') {
    const existing = await connectorService.findFirstByUserIdAndType(user.id, type)

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

  // Encrypt config
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

  // Create connector
  const connector = await connectorService.create({
    userId: user.id,
    type,
    name: name.trim(),
    config: encryptedConfig,
    enabled: true,
  })

  // Audit log
  await auditEvent({
    actorUserId: session.user.id,
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
}
