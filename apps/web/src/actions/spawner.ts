'use server'

import { cookies } from 'next/headers'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { startInstance, stopInstance, getInstanceStatus, isSlowStart, listActiveInstances } from '@/lib/spawner/core'

async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return getSessionFromToken(token)
}

export type SpawnerActionResult =
  | { ok: true; status: string }
  | { ok: false; error: string }

export async function startInstanceAction(slug: string): Promise<SpawnerActionResult> {
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'unauthorized' }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false, error: 'forbidden' }
  }

  return startInstance(slug, session.user.id)
}

export async function stopInstanceAction(slug: string): Promise<SpawnerActionResult> {
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'unauthorized' }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false, error: 'forbidden' }
  }

  return stopInstance(slug, session.user.id)
}

export async function getInstanceStatusAction(slug: string) {
  const session = await getAuthenticatedUser()
  if (!session) return null

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return null
  }

  const instance = await getInstanceStatus(slug)
  if (!instance) return { status: 'stopped' as const, slowStart: false }

  return {
    ...instance,
    slowStart: isSlowStart(instance),
  }
}

export async function listActiveInstancesAction() {
  const session = await getAuthenticatedUser()
  if (!session) return []

  // Solo admins pueden ver todas las instancias activas
  if (session.user.role !== 'ADMIN') {
    // Usuarios normales solo ven su propia instancia si está activa
    const own = await getInstanceStatus(session.user.slug)
    if (own && (own.status === 'running' || own.status === 'starting')) {
      return [{
        slug: session.user.slug,
        status: own.status,
        startedAt: own.startedAt,
        lastActivityAt: own.lastActivityAt,
      }]
    }
    return []
  }

  return listActiveInstances()
}

/**
 * Asegura que la instancia esté corriendo. Si no lo está, la inicia.
 * Retorna el estado actual de la instancia.
 */
export async function ensureInstanceRunningAction(slug: string): Promise<{
  status: 'running' | 'starting' | 'error'
  error?: string
}> {
  console.log('[ensureInstanceRunning] Starting for slug:', slug)
  
  const session = await getAuthenticatedUser()
  if (!session) {
    console.log('[ensureInstanceRunning] No session - unauthorized')
    return { status: 'error', error: 'unauthorized' }
  }
  console.log('[ensureInstanceRunning] Session user:', session.user.slug, 'role:', session.user.role)

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    console.log('[ensureInstanceRunning] Forbidden - slug mismatch')
    return { status: 'error', error: 'forbidden' }
  }

  const instance = await getInstanceStatus(slug)
  console.log('[ensureInstanceRunning] Current instance status:', instance?.status ?? 'none')
  
  // Ya está corriendo o iniciando
  if (instance?.status === 'running') {
    return { status: 'running' }
  }
  if (instance?.status === 'starting') {
    return { status: 'starting' }
  }

  // Necesita iniciar
  console.log('[ensureInstanceRunning] Starting instance...')
  const result = await startInstance(slug, session.user.id)
  console.log('[ensureInstanceRunning] Start result:', result)
  
  if (!result.ok) {
    return { status: 'error', error: result.error }
  }

  return { status: 'starting' }
}
