import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedUser } from '@/lib/auth'
import { decryptConfig } from '@/lib/connectors/crypto'
import type { ConnectorType } from '@/lib/connectors/types'

export interface TestConnectionResult {
  ok: boolean
  tested: boolean
  message?: string
}

/**
 * Prueba la conexión de un conector.
 *
 * TODO: Implementar pruebas reales por tipo de conector.
 * Por ahora solo valida que el conector existe y tiene config.
 */
async function testConnection(
  type: ConnectorType,
  config: Record<string, unknown>
): Promise<TestConnectionResult> {
  // Stub implementation - en el futuro hacer llamadas reales a cada API
  switch (type) {
    case 'linear':
      // TODO: Probar Linear API con config.apiKey
      if (!config.apiKey) {
        return { ok: false, tested: false, message: 'Missing API key' }
      }
      return { ok: true, tested: false, message: 'Linear connection test pending implementation' }

    case 'notion':
      // TODO: Probar Notion API con config.apiKey
      if (!config.apiKey) {
        return { ok: false, tested: false, message: 'Missing API key' }
      }
      return { ok: true, tested: false, message: 'Notion connection test pending implementation' }

    case 'slack':
      // TODO: Probar Slack API con config.botToken
      if (!config.botToken) {
        return { ok: false, tested: false, message: 'Missing bot token' }
      }
      return { ok: true, tested: false, message: 'Slack connection test pending implementation' }

    case 'github':
      // TODO: Probar GitHub API con config.token
      if (!config.token) {
        return { ok: false, tested: false, message: 'Missing token' }
      }
      return { ok: true, tested: false, message: 'GitHub connection test pending implementation' }

    case 'custom':
      // TODO: Hacer ping al endpoint custom
      if (!config.endpoint) {
        return { ok: false, tested: false, message: 'Missing endpoint' }
      }
      return { ok: true, tested: false, message: 'Custom endpoint test pending implementation' }

    default:
      return { ok: false, tested: false, message: `Unknown connector type: ${type}` }
  }
}

/**
 * POST /api/u/[slug]/connectors/[id]/test
 *
 * Prueba la conexión del conector.
 *
 * Response: { ok: boolean, tested: boolean, message?: string }
 *
 * Códigos:
 * - 200: Test ejecutado (ok indica si fue exitoso, tested si realmente se probó)
 * - 401: No autenticado
 * - 403: No autorizado
 * - 404: Usuario o conector no encontrado
 * - 409: Conector deshabilitado
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<TestConnectionResult | { error: string }>> {
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

  // Obtener conector verificando ownership
  const connector = await prisma.connector.findFirst({
    where: { id, userId: user.id },
  })

  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  // Verificar que está habilitado
  if (!connector.enabled) {
    return NextResponse.json({ error: 'connector_disabled' }, { status: 409 })
  }

  // Desencriptar config y probar conexión
  let config: Record<string, unknown>
  try {
    config = decryptConfig(connector.config)
  } catch {
    return NextResponse.json(
      { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
      { status: 500 }
    )
  }

  const result = await testConnection(connector.type as ConnectorType, config)

  return NextResponse.json(result)
}
