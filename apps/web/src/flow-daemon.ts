import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'

import {
  FLOW_SCHEDULER_INTERVAL_MS,
  getFlowSchedulerMode,
  getFlowSchedulerStatus,
  startFlowScheduler,
  stopFlowScheduler,
} from '@/lib/flows/scheduler'
import { hasBareRepoLayout, resolveRepoRoot } from '@/lib/git/bare-repo'
import { prisma } from '@/lib/prisma'
import { getKbConfigRoot, getUsersBasePath } from '@/lib/runtime/paths'

declare global {
  var archeFlowCleanupRegistered: boolean | undefined
}

const FLOW_WATCHDOG_INTERVAL_MS = 60_000
export const FLOW_WATCHDOG_TIMEOUT_MS = FLOW_SCHEDULER_INTERVAL_MS * 4 + 120_000

function getHealthyFlowHeartbeat(): Date | null {
  const status = getFlowSchedulerStatus()
  return status.lastDispatchFinishedAt ?? status.lastDispatchStartedAt
}

function isFlowSchedulerHealthy(now: number): boolean {
  const status = getFlowSchedulerStatus()
  if (!status.running) return false

  const heartbeat = getHealthyFlowHeartbeat()
  if (!heartbeat) return true

  return now - heartbeat.getTime() <= FLOW_WATCHDOG_TIMEOUT_MS
}

async function ensureKbConfigAvailable(): Promise<void> {
  const configuredRoot = getKbConfigRoot()
  const root = await resolveRepoRoot(configuredRoot)
  if (!root) {
    throw new Error(`kb_unavailable: ${configuredRoot} does not exist or is not a directory`)
  }

  if (!(await hasBareRepoLayout(root))) {
    throw new Error(`kb_unavailable: ${root} is not a bare git repository`)
  }
}

async function ensureUserDataPathAvailable(): Promise<void> {
  const usersBasePath = getUsersBasePath()
  const stats = await fs.stat(usersBasePath).catch(() => null)
  if (!stats?.isDirectory()) {
    throw new Error(`user_data_unavailable: ${usersBasePath} does not exist or is not a directory`)
  }

  await fs.access(usersBasePath, constants.W_OK).catch(() => {
    throw new Error(`user_data_unavailable: ${usersBasePath} is not writable`)
  })
}

function startFlowWatchdog(): NodeJS.Timeout {
  return setInterval(() => {
    if (isFlowSchedulerHealthy(Date.now())) return

    console.error('[flow-daemon] Watchdog detected an unhealthy scheduler state', {
      ...getFlowSchedulerStatus(),
      watchdogTimeoutMs: FLOW_WATCHDOG_TIMEOUT_MS,
    })
    process.exit(1)
  }, FLOW_WATCHDOG_INTERVAL_MS)
}

async function gracefulShutdown(watchdog: NodeJS.Timeout): Promise<void> {
  clearInterval(watchdog)

  try {
    stopFlowScheduler()
    console.log('[flow-daemon] Flow scheduler stopped')
  } catch (error) {
    console.error('[flow-daemon] Failed to stop flow scheduler', error)
  }

  try {
    await prisma.$disconnect()
    console.log('[flow-daemon] Prisma disconnected')
  } catch (error) {
    console.error('[flow-daemon] Failed to disconnect Prisma', error)
  }
}

function registerShutdownHooks(watchdog: NodeJS.Timeout): void {
  if (globalThis.archeFlowCleanupRegistered) return

  globalThis.archeFlowCleanupRegistered = true

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

export async function startFlowDaemon(): Promise<void> {
  const mode = getFlowSchedulerMode()
  if (mode !== 'daemon') {
    console.log('[flow-daemon] Flow daemon not started for scheduler mode', { mode })
    await prisma.$disconnect()
    return
  }

  const { initWebPrisma } = await import('@/lib/prisma')
  await ensureKbConfigAvailable()
  await ensureUserDataPathAvailable()
  await initWebPrisma()

  startFlowScheduler()
  const watchdog = startFlowWatchdog()
  registerShutdownHooks(watchdog)

  console.log('[flow-daemon] Flow daemon started', { mode })
}

if (!process.env.VITEST) {
  void startFlowDaemon().catch((error) => {
    console.error('[flow-daemon] Failed to start flow daemon', error)
    process.exit(1)
  })
}
