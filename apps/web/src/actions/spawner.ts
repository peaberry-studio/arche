'use server'

import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { getSession } from '@/lib/runtime/session'
import { getWorkspaceConnection, getWorkspaceStatus, startWorkspace, stopWorkspace } from '@/lib/runtime/workspace-host'
import { providerService, userService } from '@/lib/services'
import { isSlowStart, listActiveInstances } from '@/lib/spawner/core'
import { getKickstartStatus } from '@/kickstart/status'

export type SpawnerActionResult =
  | { ok: true; status: string }
  | { ok: false; error: string }

export async function startInstanceAction(slug: string): Promise<SpawnerActionResult> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'unauthorized' }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false, error: 'forbidden' }
  }

  const kickstartStatus = await getKickstartStatus()
  if (kickstartStatus !== 'ready') {
    return { ok: false, error: 'setup_required' }
  }

  return startWorkspace(slug, session.user.id)
}

export async function stopInstanceAction(slug: string): Promise<SpawnerActionResult> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'unauthorized' }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false, error: 'forbidden' }
  }

  return stopWorkspace(slug, session.user.id)
}

export async function getInstanceStatusAction(slug: string) {
  const session = await getSession()
  if (!session) return null

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return null
  }

  const instance = await getWorkspaceStatus(slug)
  if (!instance) return { status: 'stopped' as const, slowStart: false }

  return {
    ...instance,
    slowStart: isSlowStart(instance),
  }
}

export async function listActiveInstancesAction() {
  const session = await getSession()
  if (!session) return []

  // Only admins can view all active instances
  if (session.user.role !== 'ADMIN') {
    // Regular users can only see their own instance if it is active
    const own = await getWorkspaceStatus(session.user.slug)
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

  try {
    const session = await getSession()
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

    const instance = await getWorkspaceStatus(slug)
    console.log('[ensureInstanceRunning] Current instance status:', instance?.status ?? 'none')

    if (instance?.status === 'running') {
      const syncUserId =
        session.user.slug === slug
          ? session.user.id
          : (await userService.findIdBySlug(slug))?.id

      try {
        const instanceConn = await getWorkspaceConnection(slug)
        if (instanceConn && syncUserId) {
          const syncResult = await syncProviderAccessForInstance({
            instance: instanceConn,
            slug,
            userId: syncUserId,
          })
          if (!syncResult.ok) {
            await providerService.markWorkspaceRestartRequired(syncUserId)
            console.error('[ensureInstanceRunning] Failed to sync OpenCode providers', syncResult.error)
          } else {
            await providerService.clearWorkspaceRestartRequired(syncUserId)
          }
        } else if (syncUserId) {
          await providerService.markWorkspaceRestartRequired(syncUserId)
        }
      } catch (err) {
        if (syncUserId) {
          await providerService.markWorkspaceRestartRequired(syncUserId)
        }
        console.error('[ensureInstanceRunning] Failed to sync OpenCode providers', err)
      }

      return { status: 'running' }
    }

    if (instance?.status === 'starting') {
      return { status: 'starting' }
    }

    console.log('[ensureInstanceRunning] Starting instance...')
    const result = await startWorkspace(slug, session.user.id)
    console.log('[ensureInstanceRunning] Start result:', result)

    if (!result.ok) {
      return { status: 'error', error: result.detail ?? result.error }
    }

    if (
      result.status === 'running' ||
      result.status === 'started' ||
      result.status === 'already_running'
    ) {
      return { status: 'running' }
    }

    return { status: 'starting' }
  } catch (error) {
    console.error('[ensureInstanceRunning] Unexpected startup failure', { slug, error })
    return { status: 'error', error: 'status_check_failed' }
  }
}
