import { auditService, instanceService, messageRunService } from '@/lib/services'
import { getIdleTimeoutMinutes } from './config'

export const REAPER_INTERVAL_MS = 5 * 60 * 1000

let reaperInterval: NodeJS.Timeout | null = null
let lastRunError: string | null = null
let lastRunFinishedAt: Date | null = null
let lastRunStartedAt: Date | null = null

export type ReaperStatus = {
  lastRunError: string | null
  lastRunFinishedAt: Date | null
  lastRunStartedAt: Date | null
  running: boolean
}

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

export async function reapStaleMessageRuns(): Promise<number> {
  return messageRunService.reapStaleRuns()
}

export function getReaperStatus(): ReaperStatus {
  return {
    lastRunError,
    lastRunFinishedAt,
    lastRunStartedAt,
    running: reaperInterval !== null,
  }
}

async function runReaperCycle(): Promise<void> {
  lastRunStartedAt = new Date()

  try {
    const [instanceCount, messageRunCount] = await Promise.all([
      reapIdleInstances(),
      reapStaleMessageRuns(),
    ])
    lastRunError = null

    if (instanceCount > 0) {
      console.error(`[reaper] Stopped ${instanceCount} idle instance(s)`)
    }
    if (messageRunCount > 0) {
      console.error(`[reaper] Failed ${messageRunCount} stale message run(s)`)
    }
  } catch (err) {
    lastRunError = err instanceof Error ? err.message : 'reaper_error'
    console.error('[reaper] Error:', err)
  } finally {
    lastRunFinishedAt = new Date()
  }
}

export function startReaper(): void {
  if (reaperInterval) return

  reaperInterval = setInterval(() => {
    void runReaperCycle()
  }, REAPER_INTERVAL_MS)

  void runReaperCycle()
}

export function stopReaper(): void {
  if (reaperInterval) {
    clearInterval(reaperInterval)
    reaperInterval = null
  }
}
