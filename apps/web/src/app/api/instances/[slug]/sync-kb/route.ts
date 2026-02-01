import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { execInContainer } from '@/lib/spawner/docker'

export interface SyncKbResult {
  ok: boolean
  status: 'synced' | 'conflicts' | 'no_remote' | 'error'
  message?: string
  conflicts?: string[]
}

async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return getSessionFromToken(token)
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
    // 1. Verificar que el remote 'kb' existe
    const remoteCheck = await execInContainer(
      instance.containerId,
      ['git', 'remote', 'get-url', 'kb'],
      { timeout: 5000 }
    )

    if (remoteCheck.exitCode !== 0) {
      return NextResponse.json({
        ok: false,
        status: 'no_remote',
        message: 'KB remote not configured. Workspace may not have been initialized with KB.',
      })
    }

    // 2. Fetch desde el remote kb
    const fetchResult = await execInContainer(
      instance.containerId,
      ['git', 'fetch', 'kb'],
      { timeout: 30000 }
    )

    if (fetchResult.exitCode !== 0) {
      return NextResponse.json({
        ok: false,
        status: 'error',
        message: `Fetch failed: ${fetchResult.stderr}`,
      })
    }

    // 3. Verificar si hay algo que mergear
    // Obtenemos la rama actual y la rama remota
    const branchResult = await execInContainer(
      instance.containerId,
      ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
      { timeout: 5000 }
    )
    const currentBranch = branchResult.stdout.trim() || 'main'

    // 4. Intentar merge
    const mergeResult = await execInContainer(
      instance.containerId,
      ['git', 'merge', `kb/${currentBranch}`, '--no-edit'],
      { timeout: 30000 }
    )

    if (mergeResult.exitCode === 0) {
      // Merge exitoso
      return NextResponse.json({
        ok: true,
        status: 'synced',
        message: 'KB synchronized successfully',
      })
    }

    // 5. Verificar si hay conflictos
    const statusResult = await execInContainer(
      instance.containerId,
      ['git', 'diff', '--name-only', '--diff-filter=U'],
      { timeout: 5000 }
    )

    const conflictFiles = statusResult.stdout
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0)

    if (conflictFiles.length > 0) {
      return NextResponse.json({
        ok: true,
        status: 'conflicts',
        message: 'Merge has conflicts that need to be resolved',
        conflicts: conflictFiles,
      })
    }

    // Otro error de merge
    return NextResponse.json({
      ok: false,
      status: 'error',
      message: `Merge failed: ${mergeResult.stderr}`,
    })
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
    // Verificar si hay conflictos de merge pendientes
    const statusResult = await execInContainer(
      instance.containerId,
      ['git', 'diff', '--name-only', '--diff-filter=U'],
      { timeout: 5000 }
    )

    const conflictFiles = statusResult.stdout
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0)

    return NextResponse.json({
      hasConflicts: conflictFiles.length > 0,
      conflicts: conflictFiles.length > 0 ? conflictFiles : undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
