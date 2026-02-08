import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedUser, auditEvent } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import {
  validateConnectorType,
  validateConnectorConfig,
  validateConnectorName,
} from '@/lib/connectors/validators'

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
 * Lista los conectores del usuario (sin config/credentials).
 *
 * Response: { connectors: ConnectorListItem[] }
 *
 * Códigos:
 * - 200: Lista de conectores
 * - 401: No autenticado
 * - 403: No autorizado (otro usuario)
 * - 404: Usuario no encontrado
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<{ connectors: ConnectorListItem[] } | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params

  // Verificar autorización: owner OR ADMIN
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Obtener usuario por slug
  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  // Listar conectores (sin config)
  const connectors = await prisma.connector.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      type: true,
      name: true,
      enabled: true,
      config: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

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
 * Crea un nuevo conector.
 *
 * Request: { type, name, config }
 * Response: { id, type, name, enabled, createdAt }
 *
 * Códigos:
 * - 201: Conector creado
 * - 400: Validación fallida (tipo inválido, campos faltantes)
 * - 401: No autenticado
 * - 403: No autorizado
 * - 404: Usuario no encontrado
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<ConnectorResponse | { error: string; message?: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug } = await params

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

  // Parsear body
  let body: CreateConnectorRequest
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

  const { type, name, config } = body

  // Validar campos requeridos
  if (!type || !name || !config) {
    return NextResponse.json(
      { error: 'missing_fields', message: 'type, name, and config are required' },
      { status: 400 }
    )
  }

  // Validar que config es un objeto no-null
  if (typeof config !== 'object' || Array.isArray(config)) {
    return NextResponse.json(
      { error: 'invalid_config', message: 'config must be a non-null object' },
      { status: 400 }
    )
  }

  // Validar nombre
  const nameValidation = validateConnectorName(name)
  if (!nameValidation.valid) {
    return NextResponse.json(
      { error: 'invalid_name', message: nameValidation.error },
      { status: 400 }
    )
  }

  // Validar tipo de conector
  if (!validateConnectorType(type)) {
    return NextResponse.json(
      { error: 'invalid_type', message: `Invalid connector type: ${type}` },
      { status: 400 }
    )
  }

  // Validar config según tipo
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
    const existing = await prisma.connector.findFirst({
      where: {
        userId: user.id,
        type,
      },
      select: { id: true },
    })

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

  // Encriptar config
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

  // Crear conector
  const connector = await prisma.connector.create({
    data: {
      userId: user.id,
      type,
      name: name.trim(),
      config: encryptedConfig,
      enabled: true,
    },
    select: {
      id: true,
      type: true,
      name: true,
      enabled: true,
      createdAt: true,
    },
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
