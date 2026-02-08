import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedUser } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export interface SyncKbResult {
  ok: boolean
  status: 'synced' | 'conflicts' | 'no_remote' | 'error'
  message?: string
  conflicts?: string[]
}

/**
 * POST /api/instances/[slug]/sync-kb
 * 
 * Sincroniza el Knowledge Base en el workspace del usuario.
 * Ejecuta git fetch + git merge desde el remote 'kb'.
 * 
 * Respuestas:
 * - 200 { ok: true, status: 'synced' } - Sync exitoso sin conflictos
 * - 200 { ok: true, status: 'conflicts', conflicts: [...] } - Hay conflictos que resolver
 * - 200 { ok: false, status: 'no_remote' } - El remote 'kb' no existe
 * - 200 { ok: false, status: 'error', message: '...' } - Error durante el sync
 * - 401 - No autenticado
 * - 403 - No autorizado para esta instancia
 * - 404 - Instancia no encontrada
 * - 409 - Instancia no está corriendo
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<SyncKbResult | { error: string }>> {
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

  // Obtener instancia
  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { containerId: true, status: true },
  })

  if (!instance) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (instance.status !== 'running' || !instance.containerId) {
    return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
  }

  try {
    const agent = await createWorkspaceAgentClient(slug)
    if (!agent) {
      return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
    }

    const response = await fetch(`${agent.baseUrl}/kb/sync`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        Accept: 'application/json'
      },
      cache: 'no-store'
    })

    const data = await response.json().catch(() => null) as SyncKbResult | null
    if (!response.ok || !data) {
      const errorText = data?.message ?? `workspace_agent_http_${response.status}`
      return NextResponse.json({
        ok: false,
        status: 'error',
        message: errorText,
      })
    }

    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({
      ok: false,
      status: 'error',
      message,
    })
  }
}

/**
 * GET /api/instances/[slug]/sync-kb
 * 
 * Obtiene el estado actual del sync (si hay conflictos pendientes, etc.)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<{ hasConflicts: boolean; conflicts?: string[] } | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { containerId: true, status: true },
  })

  if (!instance) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (instance.status !== 'running' || !instance.containerId) {
    return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
  }

  try {
    const agent = await createWorkspaceAgentClient(slug)
    if (!agent) {
      return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
    }

    const response = await fetch(`${agent.baseUrl}/kb/status`, {
      headers: {
        Authorization: agent.authHeader,
        Accept: 'application/json'
      },
      cache: 'no-store'
    })

    const data = await response.json().catch(() => null) as { ok?: boolean; hasConflicts?: boolean; conflicts?: string[]; error?: string } | null
    if (!response.ok || !data || data.ok === false) {
      const errorText = data?.error ?? `workspace_agent_http_${response.status}`
      return NextResponse.json({ error: errorText }, { status: 500 })
    }

    return NextResponse.json({
      hasConflicts: Boolean(data.hasConflicts),
      conflicts: data.conflicts && data.conflicts.length > 0 ? data.conflicts : undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
