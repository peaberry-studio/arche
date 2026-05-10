import { prisma } from '@/lib/prisma'
import {
  AUTOPILOT_SCHEDULER_INTERVAL_MS,
  getAutopilotSchedulerMode,
  getAutopilotSchedulerStatus,
  startAutopilotScheduler,
  stopAutopilotScheduler,
} from '@/lib/autopilot/scheduler'

declare global {
  var archeAutopilotCleanupRegistered: boolean | undefined
}

const AUTOPILOT_WATCHDOG_INTERVAL_MS = 60_000
export const AUTOPILOT_WATCHDOG_TIMEOUT_MS = AUTOPILOT_SCHEDULER_INTERVAL_MS * 4 + 120_000

function getHealthyAutopilotHeartbeat(): Date | null {
  const status = getAutopilotSchedulerStatus()
  return status.lastDispatchFinishedAt ?? status.lastDispatchStartedAt
}

function isAutopilotSchedulerHealthy(now: number): boolean {
  const status = getAutopilotSchedulerStatus()
  if (!status.running) {
    return false
  }

  const heartbeat = getHealthyAutopilotHeartbeat()
  if (!heartbeat) {
    return true
  }

  return now - heartbeat.getTime() <= AUTOPILOT_WATCHDOG_TIMEOUT_MS
}

function startAutopilotWatchdog(): NodeJS.Timeout {
  return setInterval(() => {
    if (isAutopilotSchedulerHealthy(Date.now())) {
      return
    }

    console.error('[autopilot-daemon] Watchdog detected an unhealthy scheduler state', {
      ...getAutopilotSchedulerStatus(),
      watchdogTimeoutMs: AUTOPILOT_WATCHDOG_TIMEOUT_MS,
    })
    process.exit(1)
  }, AUTOPILOT_WATCHDOG_INTERVAL_MS)
}

async function gracefulShutdown(watchdog: NodeJS.Timeout): Promise<void> {
  clearInterval(watchdog)

  try {
    stopAutopilotScheduler()
    console.log('[autopilot-daemon] Autopilot scheduler stopped')
  } catch (error) {
    console.error('[autopilot-daemon] Failed to stop autopilot scheduler', error)
  }

  try {
    await prisma.$disconnect()
    console.log('[autopilot-daemon] Prisma disconnected')
  } catch (error) {
    console.error('[autopilot-daemon] Failed to disconnect Prisma', error)
  }
}

function registerShutdownHooks(watchdog: NodeJS.Timeout): void {
  if (globalThis.archeAutopilotCleanupRegistered) {
    return
  }

  globalThis.archeAutopilotCleanupRegistered = true

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

export async function startAutopilotDaemon(): Promise<void> {
  const mode = getAutopilotSchedulerMode()
  if (mode !== 'daemon') {
    console.log('[autopilot-daemon] Autopilot daemon not started for scheduler mode', { mode })
    await prisma.$disconnect()
    return
  }

  const { initWebPrisma } = await import('@/lib/prisma')
  await initWebPrisma()

  startAutopilotScheduler()
  const watchdog = startAutopilotWatchdog()
  registerShutdownHooks(watchdog)

  console.log('[autopilot-daemon] Autopilot daemon started', { mode })
}

if (!process.env.VITEST) {
  void startAutopilotDaemon().catch((error) => {
    console.error('[autopilot-daemon] Failed to start autopilot daemon', error)
    process.exit(1)
  })
}
