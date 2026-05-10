import { getNextAutopilotRunAt } from '@/lib/autopilot/cron'
import {
  AUTOPILOT_TASK_LEASE_MS,
  runClaimedAutopilotTask,
} from '@/lib/autopilot/runner'
import { autopilotService } from '@/lib/services'

export const AUTOPILOT_SCHEDULER_INTERVAL_MS = 30_000
const AUTOPILOT_SCHEDULER_BATCH_LIMIT = 4
const AUTOPILOT_SCHEDULER_MODE_ENV = 'ARCHE_AUTOPILOT_SCHEDULER_MODE'

export type AutopilotSchedulerMode = 'daemon' | 'inline' | 'off'

let schedulerInterval: NodeJS.Timeout | null = null
let dispatchPromise: Promise<number> | null = null
let lastDispatchStartedAt: Date | null = null
let lastDispatchFinishedAt: Date | null = null
let lastDispatchError: string | null = null
let loggedSchedulerMode: AutopilotSchedulerMode | null = null

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getAutopilotSchedulerMode(): AutopilotSchedulerMode {
  const mode = process.env[AUTOPILOT_SCHEDULER_MODE_ENV]
  if (mode === 'daemon' || mode === 'inline' || mode === 'off') {
    logResolvedSchedulerMode(mode)
    return mode
  }

  if (process.env.NODE_ENV === 'production') {
    const detail = mode ? `invalid value "${mode}"` : 'missing value'
    throw new Error(`${AUTOPILOT_SCHEDULER_MODE_ENV} is required in production (${detail})`)
  }

  if (mode) {
    console.warn('[autopilot] Invalid scheduler mode; falling back to inline', {
      env: AUTOPILOT_SCHEDULER_MODE_ENV,
      mode,
    })
  }

  logResolvedSchedulerMode('inline')
  return 'inline'
}

function logResolvedSchedulerMode(mode: AutopilotSchedulerMode): void {
  if (loggedSchedulerMode === mode) {
    return
  }

  loggedSchedulerMode = mode
  console.log('[autopilot] Scheduler mode resolved', { mode })
}

export function shouldStartInlineAutopilotScheduler(): boolean {
  return getAutopilotSchedulerMode() === 'inline'
}

export function getAutopilotSchedulerStatus() {
  return {
    dispatching: dispatchPromise !== null,
    lastDispatchError,
    lastDispatchFinishedAt,
    lastDispatchStartedAt,
    running: schedulerInterval !== null,
  }
}

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

async function createLeaseOwner(): Promise<string> {
  const { randomUUID } = await importRuntimeModule<typeof import('crypto')>('crypto')
  return `autopilot:${process.pid}:${randomUUID()}`
}

export async function dispatchDueAutopilotTasks(limit = AUTOPILOT_SCHEDULER_BATCH_LIMIT): Promise<number> {
  lastDispatchStartedAt = new Date()
  let claimedCount = 0

  try {
    while (claimedCount < limit) {
      const now = new Date()
      const claimed = await autopilotService.claimNextDueTask({
        leaseMs: AUTOPILOT_TASK_LEASE_MS,
        leaseOwner: await createLeaseOwner(),
        now,
        resolveNextRunAt: (task) => getNextAutopilotRunAt(task.cronExpression, task.timezone, now),
      })

      if (!claimed) {
        break
      }

      claimedCount += 1
      void runClaimedAutopilotTask(claimed, 'schedule').catch((error) => {
        console.error('[autopilot] Failed to execute scheduled task run', {
          taskId: claimed.id,
          error,
        })
      })
    }

    lastDispatchError = null
    return claimedCount
  } catch (error) {
    lastDispatchError = getErrorMessage(error)
    throw error
  } finally {
    lastDispatchFinishedAt = new Date()
  }
}

function scheduleDispatch(): void {
  if (dispatchPromise) return

  dispatchPromise = dispatchDueAutopilotTasks().finally(() => {
    dispatchPromise = null
  })
}

export function startAutopilotScheduler(): void {
  if (schedulerInterval) return

  schedulerInterval = setInterval(() => {
    scheduleDispatch()
  }, AUTOPILOT_SCHEDULER_INTERVAL_MS)

  scheduleDispatch()
}

export function stopAutopilotScheduler(): void {
  if (!schedulerInterval) return

  clearInterval(schedulerInterval)
  schedulerInterval = null
}
