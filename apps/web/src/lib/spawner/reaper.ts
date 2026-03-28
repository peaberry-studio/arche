import { auditService, instanceService } from '@/lib/services'
import { getIdleTimeoutMinutes } from './config'

let reaperInterval: NodeJS.Timeout | null = null

export async function reapIdleInstances(): Promise<number> {
  const timeoutMinutes = getIdleTimeoutMinutes()
  const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000)

  const idleInstances = await instanceService.findIdleInstances(threshold)

  let reapedCount = 0

  for (const instance of idleInstances) {
    try {
      if (instance.containerId) {
        const docker = await import('./docker')
        await docker.stopContainer(instance.containerId).catch((err) => {
          console.warn('[reaper] Failed to stop container:', { slug: instance.slug, containerId: instance.containerId, error: err })
        })
        await docker.removeContainer(instance.containerId).catch((err) => {
          console.warn('[reaper] Failed to remove container:', { slug: instance.slug, containerId: instance.containerId, error: err })
        })
      }

      await instanceService.setStoppedById(instance.id)

      await auditService.createEvent({
        actorUserId: null,
        action: 'instance.reaped_idle',
        metadata: {
          slug: instance.slug,
          lastActivityAt: instance.lastActivityAt,
          idleMinutes: timeoutMinutes,
        },
      })

      reapedCount++
    } catch (err) {
      console.error('[reaper] Failed to reap instance:', { slug: instance.slug, error: err })
    }
  }

  return reapedCount
}

export function startReaper(): void {
  if (reaperInterval) return
  const REAPER_INTERVAL_MS = 5 * 60 * 1000

  reaperInterval = setInterval(async () => {
    try {
      const count = await reapIdleInstances()
      if (count > 0) {
        console.error(`[reaper] Stopped ${count} idle instance(s)`)
      }
    } catch (err) {
      console.error('[reaper] Error:', err)
    }
  }, REAPER_INTERVAL_MS)

  reapIdleInstances().catch((err) => {
    console.error('[reaper] Initial reap failed:', err)
  })
}

export function stopReaper(): void {
  if (reaperInterval) {
    clearInterval(reaperInterval)
    reaperInterval = null
  }
}
