'use server'

import { cookies } from 'next/headers'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getInstanceBasicAuth } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { startInstance, stopInstance, getInstanceStatus, isSlowStart, listActiveInstances } from '@/lib/spawner/core'
import { getKickstartStatus } from '@/kickstart/status'

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

  const kickstartStatus = await getKickstartStatus()
  if (kickstartStatus !== 'ready') {
    return { ok: false, error: 'setup_required' }
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

  // Only admins can view all active instances
  if (session.user.role !== 'ADMIN') {
    // Regular users can only see their own instance if it is active
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
 * Ensures the instance is running. If not, it starts it.
 * Returns the current instance status.
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

  const kickstartStatus = await getKickstartStatus()
  if (kickstartStatus !== 'ready') {
    console.log('[ensureInstanceRunning] Kickstart setup required')
    return { status: 'error', error: 'setup_required' }
  }

  const instance = await getInstanceStatus(slug)
  console.log('[ensureInstanceRunning] Current instance status:', instance?.status ?? 'none')
  
  // Already running or starting
  if (instance?.status === 'running') {
    const startedRecently =
      instance.startedAt instanceof Date &&
      Date.now() - instance.startedAt.getTime() < 30_000

    // Best-effort: keep provider access in sync even when instance was already running.
    // This is important when provider keys are created/rotated after the workspace was started.
    if (!startedRecently) {
      try {
        const syncUserId =
          session.user.slug === slug
            ? session.user.id
            : (await prisma.user.findUnique({ where: { slug }, select: { id: true } }))?.id

        const instanceConn = await getInstanceBasicAuth(slug)
        if (instanceConn && syncUserId) {
          const syncResult = await syncProviderAccessForInstance({
            instance: instanceConn,
            slug,
            userId: syncUserId,
          })
          if (!syncResult.ok) {
            console.error('[ensureInstanceRunning] Failed to sync OpenCode providers', syncResult.error)
          }
        }
      } catch (err) {
        console.error('[ensureInstanceRunning] Failed to sync OpenCode providers', err)
      }
    }

    return { status: 'running' }
  }
  if (instance?.status === 'starting') {
    return { status: 'starting' }
  }

  // Needs to start
  console.log('[ensureInstanceRunning] Starting instance...')
  const result = await startInstance(slug, session.user.id)
  console.log('[ensureInstanceRunning] Start result:', result)
  
  if (!result.ok) {
    return { status: 'error', error: result.detail ?? result.error }
  }

  return { status: 'starting' }
}
