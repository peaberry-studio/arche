import { randomUUID } from 'node:crypto'

import { getNextAutopilotRunAt } from '@/lib/autopilot/cron'
import {
  AUTOPILOT_TASK_LEASE_MS,
  runClaimedAutopilotTask,
} from '@/lib/autopilot/runner'
import { autopilotService } from '@/lib/services'

export const AUTOPILOT_SCHEDULER_INTERVAL_MS = 30_000
const AUTOPILOT_SCHEDULER_BATCH_LIMIT = 4

let schedulerInterval: NodeJS.Timeout | null = null
let dispatchPromise: Promise<number> | null = null

function createLeaseOwner(): string {
  return `autopilot:${process.pid}:${randomUUID()}`
}

export async function dispatchDueAutopilotTasks(limit = AUTOPILOT_SCHEDULER_BATCH_LIMIT): Promise<number> {
  let claimedCount = 0

  while (claimedCount < limit) {
    const now = new Date()
    const claimed = await autopilotService.claimNextDueTask({
      leaseMs: AUTOPILOT_TASK_LEASE_MS,
      leaseOwner: createLeaseOwner(),
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

  return claimedCount
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
