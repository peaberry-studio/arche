declare global {
  var archeReaperCleanupRegistered: boolean | undefined
}

import { prisma } from '@/lib/prisma'
import { getReaperStatus, REAPER_INTERVAL_MS, startReaper, stopReaper } from '@/lib/spawner/reaper'

const REAPER_WATCHDOG_INTERVAL_MS = 60_000
export const REAPER_WATCHDOG_TIMEOUT_MS = REAPER_INTERVAL_MS * 2 + 60_000

function getHealthyReaperHeartbeat(): Date | null {
  const status = getReaperStatus()
  return status.lastRunFinishedAt ?? status.lastRunStartedAt
}

function isReaperHealthy(now: number): boolean {
  const status = getReaperStatus()
  if (!status.running) {
    return false
  }

  const heartbeat = getHealthyReaperHeartbeat()
  if (!heartbeat) {
    return true
  }

  return now - heartbeat.getTime() <= REAPER_WATCHDOG_TIMEOUT_MS
}

function startReaperWatchdog(): NodeJS.Timeout {
  return setInterval(() => {
    if (isReaperHealthy(Date.now())) {
      return
    }

    console.error('[reaper-daemon] Watchdog detected an unhealthy reaper state', getReaperStatus())
    process.exit(1)
  }, REAPER_WATCHDOG_INTERVAL_MS)
}

async function gracefulShutdown(watchdog: NodeJS.Timeout): Promise<void> {
  clearInterval(watchdog)

  try {
    stopReaper()
    console.log('[reaper-daemon] Reaper stopped')
  } catch (error) {
    console.error('[reaper-daemon] Failed to stop reaper', error)
  }

  try {
    await prisma.$disconnect()
    console.log('[reaper-daemon] Prisma disconnected')
  } catch (error) {
    console.error('[reaper-daemon] Failed to disconnect Prisma', error)
  }
}

function registerShutdownHooks(watchdog: NodeJS.Timeout): void {
  if (globalThis.archeReaperCleanupRegistered) {
    return
  }

  globalThis.archeReaperCleanupRegistered = true

  process.once('SIGTERM', () => {
    void gracefulShutdown(watchdog).finally(() => process.kill(process.pid, 'SIGTERM'))
  })

  process.once('SIGINT', () => {
    void gracefulShutdown(watchdog).finally(() => process.kill(process.pid, 'SIGINT'))
  })

  process.once('beforeExit', () => {
    void gracefulShutdown(watchdog)
  })
}

export async function startReaperDaemon(): Promise<void> {
  const { initWebPrisma } = await import('@/lib/prisma')
  await initWebPrisma()

  startReaper()
  const watchdog = startReaperWatchdog()
  registerShutdownHooks(watchdog)

  console.log('[reaper-daemon] Reaper daemon started')
}

if (!process.env.VITEST) {
  void startReaperDaemon().catch((error) => {
    console.error('[reaper-daemon] Failed to start reaper daemon', error)
    process.exit(1)
  })
}
