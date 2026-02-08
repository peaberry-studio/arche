import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedUser, auditEvent } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import {
  validateConnectorConfig,
  validateConnectorName,
  validateConnectorType,
} from '@/lib/connectors/validators'
import type { ConnectorType } from '@/lib/connectors/types'

export interface ConnectorDetail {
  id: string
  type: string
  name: string
  config: Record<string, unknown>
  enabled: boolean
  authType: 'manual' | 'oauth'
  oauthConnected: boolean
  oauthExpiresAt?: string
  createdAt: string
  updatedAt: string
}

function sanitizeConfigForResponse(type: ConnectorType, config: Record<string, unknown>): Record<string, unknown> {
  if (getConnectorAuthType(config) !== 'oauth') return config
  const oauth = getConnectorOAuthConfig(type, config)
  if (!oauth) return config

  const oauthResponse = {
    provider: oauth.provider,
    connected: true,
    expiresAt: oauth.expiresAt,
    connectedAt: oauth.connectedAt,
    scope: oauth.scope,
  }

  return {
    ...config,
    oauth: oauthResponse,
  }
}

/**
 * GET /api/u/[slug]/connectors/[id]
 *
 * Obtiene un conector individual CON config desencriptado (para edición).
 *
 * Response: ConnectorDetail
 *
 * Códigos:
 * - 200: Conector encontrado
 * - 401: No autenticado
 * - 403: No autorizado
 * - 404: Usuario o conector no encontrado
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<ConnectorDetail | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug, id } = await params

  // Verificar autorización
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Obtener usuario
  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // Obtener conector verificando ownership en una sola query
  const connector = await prisma.connector.findFirst({
    where: { id, userId: user.id },
  })

  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Desencriptar config
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
    config: validateConnectorType(connector.type) ? sanitizeConfigForResponse(connector.type, config) : config,
    enabled: connector.enabled,
    authType: getConnectorAuthType(config),
    oauthConnected: validateConnectorType(connector.type)
      ? Boolean(getConnectorOAuthConfig(connector.type, config)?.accessToken)
      : false,
    oauthExpiresAt: validateConnectorType(connector.type)
      ? getConnectorOAuthConfig(connector.type, config)?.expiresAt
      : undefined,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
  })
}

export interface UpdateConnectorRequest {
  name?: string
  config?: Record<string, unknown>
  enabled?: boolean
}

/**
 * PATCH /api/u/[slug]/connectors/[id]
 *
 * Actualiza un conector.
 *
 * Request: { name?, config?, enabled? }
 * Response: ConnectorDetail
 *
 * Códigos:
 * - 200: Conector actualizado
 * - 400: Validación fallida
 * - 401: No autenticado
 * - 403: No autorizado
 * - 404: Usuario o conector no encontrado
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<ConnectorDetail | { error: string; message?: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug, id } = await params

  // Verificar autorización
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Obtener usuario
  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // Obtener conector existente verificando ownership
  const existingConnector = await prisma.connector.findFirst({
    where: { id, userId: user.id },
  })

  if (!existingConnector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Parsear body
  let body: UpdateConnectorRequest
  try {
    body = await request.json()
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    throw err
  }

  // Validar que body es un objeto
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be a JSON object' },
      { status: 400 }
    )
  }

  const { name, config, enabled } = body

  // Preparar datos para actualizar
  const updateData: { name?: string; config?: string; enabled?: boolean } = {}

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

  if (config !== undefined) {
    // Validar que config es un objeto no-null
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      return NextResponse.json(
        { error: 'invalid_config', message: 'config must be a non-null object' },
        { status: 400 }
      )
    }
    // Validar tipo del conector (defensa contra datos corruptos)
    if (!validateConnectorType(existingConnector.type)) {
      return NextResponse.json(
        { error: 'invalid_connector_type', message: 'Connector has invalid type in database' },
        { status: 500 }
      )
    }
    // NOTA: config es "replace total", no merge parcial.
    // Cliente debe enviar config completo con todos los campos requeridos.
    const connectorType = existingConnector.type as ConnectorType
    const configValidation = validateConnectorConfig(connectorType, config)
    if (!configValidation.valid) {
      return NextResponse.json(
        {
          error: 'invalid_config',
          message: `Missing required fields: ${configValidation.missing?.join(', ')}`,
        },
        { status: 400 }
      )
    }
    try {
      updateData.config = encryptConfig(config)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to encrypt config'
      return NextResponse.json(
        { error: 'invalid_config', message },
        { status: 400 }
      )
    }
  }

  // Validar que hay al menos un campo para actualizar
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: 'no_fields', message: 'At least one field (name, config, enabled) must be provided' },
      { status: 400 }
    )
  }

  // Si NO estamos actualizando config, validar que podemos desencriptar el existente
  // ANTES de aplicar cambios (evita mutación + 500 si config está corrupto)
  let existingDecryptedConfig: Record<string, unknown> | null = null
  if (config === undefined) {
    try {
      existingDecryptedConfig = decryptConfig(existingConnector.config)
    } catch {
      return NextResponse.json(
        { error: 'config_corrupted', message: 'Existing connector configuration is corrupted' },
        { status: 500 }
      )
    }
  }

  // Actualizar conector atómicamente verificando ownership (evita TOCTOU)
  const result = await prisma.connector.updateMany({
    where: { id, userId: user.id },
    data: updateData,
  })

  if (result.count === 0) {
    // Ownership cambió concurrentemente o conector fue eliminado
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Obtener conector actualizado para response
  const connector = await prisma.connector.findUnique({
    where: { id },
  })

  // Defensive check (shouldn't happen given updateMany succeeded)
  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Audit log
  await auditEvent({
    actorUserId: session.user.id,
    action: 'connector.updated',
    metadata: { connectorId: connector.id, fields: Object.keys(updateData) },
  })

  // Para response: usar config del request si lo actualizamos, o el existente ya desencriptado
  const responseConfig = config !== undefined
    ? config  // Ya validamos que es correcto, usamos el input directamente
    : existingDecryptedConfig!  // Ya desencriptamos antes del update

  const connectorType = validateConnectorType(connector.type) ? connector.type : null
  const authType = getConnectorAuthType(responseConfig)
  const oauthConfig = connectorType ? getConnectorOAuthConfig(connectorType, responseConfig) : null

  return NextResponse.json({
    id: connector.id,
    type: connector.type,
    name: connector.name,
    config: connectorType ? sanitizeConfigForResponse(connectorType, responseConfig) : responseConfig,
    enabled: connector.enabled,
    authType,
    oauthConnected: Boolean(oauthConfig?.accessToken),
    oauthExpiresAt: oauthConfig?.expiresAt,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
  })
}

/**
 * DELETE /api/u/[slug]/connectors/[id]
 *
 * Elimina un conector.
 *
 * Response: { ok: true }
 *
 * Códigos:
 * - 200: Conector eliminado
 * - 401: No autenticado
 * - 403: No autorizado
 * - 404: Usuario o conector no encontrado
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<{ ok: true } | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug, id } = await params

  // Verificar autorización
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Obtener usuario
  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // Eliminar conector atómicamente verificando ownership (evita TOCTOU)
  const result = await prisma.connector.deleteMany({
    where: { id, userId: user.id },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Audit log
  await auditEvent({
    actorUserId: session.user.id,
    action: 'connector.deleted',
    metadata: { connectorId: id },
  })

  return NextResponse.json({ ok: true })
}
