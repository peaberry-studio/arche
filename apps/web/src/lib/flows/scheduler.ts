import { getNextFlowRunAt } from '@/lib/flows/cron'
import { dispatchClaimedFlowRetryRun, dispatchClaimedFlowRun, FLOW_LEASE_MS } from '@/lib/flows/runner'
import { createFlowLeaseOwner } from '@/lib/flows/session-executor'
import { flowService } from '@/lib/services'

export const FLOW_SCHEDULER_INTERVAL_MS = 30_000
const FLOW_SCHEDULER_BATCH_LIMIT = 4
const FLOW_SCHEDULER_MODE_ENV = 'ARCHE_FLOW_SCHEDULER_MODE'

export type FlowSchedulerMode = 'daemon' | 'inline' | 'off'

let schedulerInterval: NodeJS.Timeout | null = null
let dispatchPromise: Promise<number> | null = null
let lastDispatchStartedAt: Date | null = null
let lastDispatchFinishedAt: Date | null = null
let lastDispatchError: string | null = null
let loggedSchedulerMode: FlowSchedulerMode | null = null

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logResolvedSchedulerMode(mode: FlowSchedulerMode): void {
  if (loggedSchedulerMode === mode) return
  loggedSchedulerMode = mode
  console.log('[flows] Scheduler mode resolved', { mode })
}

export function getFlowSchedulerMode(): FlowSchedulerMode {
  const mode = process.env[FLOW_SCHEDULER_MODE_ENV]
  if (mode === 'daemon' || mode === 'inline' || mode === 'off') {
    logResolvedSchedulerMode(mode)
    return mode
  }

  if (process.env.NODE_ENV === 'production') {
    const detail = mode ? `invalid value "${mode}"` : 'missing value'
    throw new Error(`${FLOW_SCHEDULER_MODE_ENV} is required in production (${detail})`)
  }

  if (mode) {
    console.warn('[flows] Invalid scheduler mode; falling back to inline', {
      env: FLOW_SCHEDULER_MODE_ENV,
      mode,
    })
  }

  logResolvedSchedulerMode('inline')
  return 'inline'
}

export function shouldStartInlineFlowScheduler(): boolean {
  return getFlowSchedulerMode() === 'inline'
}

export function getFlowSchedulerStatus() {
  return {
    dispatching: dispatchPromise !== null,
    lastDispatchError,
    lastDispatchFinishedAt,
    lastDispatchStartedAt,
    running: schedulerInterval !== null,
  }
}

export async function dispatchDueFlows(limit = FLOW_SCHEDULER_BATCH_LIMIT): Promise<number> {
  lastDispatchStartedAt = new Date()
  let claimedCount = 0

  try {
    while (claimedCount < limit) {
      const now = new Date()
      const retry = await flowService.claimNextRetryRun({
        leaseMs: FLOW_LEASE_MS,
        leaseOwner: await createFlowLeaseOwner(),
        now,
      })

      if (retry) {
        claimedCount += 1
        void dispatchClaimedFlowRetryRun(retry).catch((error) => {
          console.error('[flows] Failed to execute scheduled flow retry', {
            error,
            flowId: retry.id,
            runId: retry.retryRun.id,
          })
        })
        continue
      }

      const claimed = await flowService.claimNextDueFlow({
        leaseMs: FLOW_LEASE_MS,
        leaseOwner: await createFlowLeaseOwner(),
        now,
        resolveNextRunAt: (flow) => flow.cronExpression
          ? getNextFlowRunAt(flow.cronExpression, flow.timezone, now)
          : null,
      })

      if (!claimed) break

      claimedCount += 1
      void dispatchClaimedFlowRun(claimed, 'schedule').catch((error) => {
        console.error('[flows] Failed to execute scheduled flow run', {
          error,
          flowId: claimed.id,
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

  dispatchPromise = dispatchDueFlows().finally(() => {
    dispatchPromise = null
  })
}

export function startFlowScheduler(): void {
  if (schedulerInterval) return

  schedulerInterval = setInterval(() => {
    scheduleDispatch()
  }, FLOW_SCHEDULER_INTERVAL_MS)

  scheduleDispatch()
}

export function stopFlowScheduler(): void {
  if (!schedulerInterval) return

  clearInterval(schedulerInterval)
  schedulerInterval = null
}
