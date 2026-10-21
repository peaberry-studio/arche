import { preArchiveRunningV1Instances } from '@/lib/harness/legacy-session-archive'
import { auditService, instanceService, messageRunService, rateLimitService } from '@/lib/services'
import type { InstanceRecord } from '@/lib/services/instance'
import {
  getIdleTimeoutMinutes,
  getReaperMinAvailableMemoryMb,
  getReaperMinAvailableMemoryPercent,
} from '@/lib/spawner/config'
import { type HostMemory, isUnderMemoryPressure, readHostMemory } from '@/lib/spawner/host-resources'

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

// Workspaces stay running so opening one is instant. They are only stopped
// while the host is short on memory: longest idle first, never one idle for
// less than the configured minimum, re-measuring after every stop.
export const MAX_REAPED_INSTANCES_PER_CYCLE = 3

export async function reapIdleInstances(): Promise<number> {
  const minIdleMinutes = getIdleTimeoutMinutes()
  const policy = {
    minAvailableMb: getReaperMinAvailableMemoryMb(),
    minAvailablePercent: getReaperMinAvailableMemoryPercent(),
  }
  let memory = await readHostMemory()
  if (!isUnderMemoryPressure(memory, policy)) return 0

  const threshold = new Date(Date.now() - minIdleMinutes * 60 * 1000)
  const candidates = await instanceService.findIdleInstances(threshold)
  if (candidates.length === 0) {
    console.warn('[reaper] Host memory is low but no instance has been idle long enough to stop', {
      ...describeMemory(memory),
      minIdleMinutes,
    })
    return 0
  }

  let reapedCount = 0
  for (const instance of candidates) {
    if (reapedCount >= MAX_REAPED_INSTANCES_PER_CYCLE || !isUnderMemoryPressure(memory, policy)) break
    if (!await stopIdleInstance(instance, memory)) continue
    reapedCount++
    memory = await readHostMemory()
  }

  return reapedCount
}

function describeMemory(memory: HostMemory) {
  return {
    availableMb: Math.round(memory.availableBytes / 1024 / 1024),
    totalMb: Math.round(memory.totalBytes / 1024 / 1024),
  }
}

// Race-safe teardown: claim the instance, stop and remove its container, then
// finish only if this attempt still owns the transition.
async function stopIdleInstance(instance: InstanceRecord, memory: HostMemory): Promise<boolean> {
  const startedAt = new Date()
  let ownsTransition = false
  try {
    const claimed = await instanceService.claimStartingTransition(instance, startedAt)
    if (claimed.count === 0) return false
    ownsTransition = true
    if (instance.containerId) {
      const docker = await import('@/lib/spawner/docker')
      let stopConfirmed = false
      await docker.stopContainer(instance.containerId).then(() => { stopConfirmed = true }, (err) => {
        console.warn('[reaper] Failed to stop container:', { slug: instance.slug, containerId: instance.containerId, error: err })
      })
      await docker.removeContainer(instance.containerId).catch((err) => {
        console.warn('[reaper] Failed to remove container:', { slug: instance.slug, containerId: instance.containerId, error: err })
        if (!stopConfirmed) throw err
      })
    }

    const stopped = await instanceService.finishStoppingTransition(instance.id, startedAt)
    if (stopped.count === 0) return false

    await auditService.createEvent({
      actorUserId: null,
      action: 'instance.reaped_idle',
      metadata: {
        slug: instance.slug,
        reason: 'memory_pressure',
        lastActivityAt: instance.lastActivityAt,
        idleMinutes: instance.lastActivityAt ? Math.floor((startedAt.getTime() - instance.lastActivityAt.getTime()) / 60_000) : null,
        ...describeMemory(memory),
      },
    })
    return true
  } catch (err) {
    if (ownsTransition) {
      await instanceService.recoverStoppingTransition(instance, startedAt).catch((error) => {
        console.error('[reaper] Failed to recover shutdown ownership:', { slug: instance.slug, error })
      })
    }
    console.error('[reaper] Failed to reap instance:', { slug: instance.slug, error: err })
    return false
  }
}

export async function reapStaleMessageRuns(): Promise<number> {
  return messageRunService.reapStaleRuns()
}

export async function reapExpiredRateLimitBuckets(): Promise<number> {
  const result = await rateLimitService.deleteExpiredRateLimitBuckets()
  return result.count
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
  void preArchiveRunningV1Instances()

  try {
    const [instanceCount, messageRunCount] = await Promise.all([
      reapIdleInstances(),
      reapStaleMessageRuns(),
      reapExpiredRateLimitBuckets(),
    ])
    lastRunError = null

    if (instanceCount > 0) {
      console.error(`[reaper] Stopped ${instanceCount} idle instance(s) to relieve memory pressure`)
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
