import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedUser } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'

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
  config: Record<string, unknown>
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

        const response = await fetchWithTimeout(endpoint, {
          method: 'GET',
          headers,
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

  if (!validateConnectorType(connector.type)) {
    return NextResponse.json({ error: 'unsupported_connector_type' }, { status: 400 })
  }

  const result = await testConnection(connector.type, config)

  return NextResponse.json(result)
}
