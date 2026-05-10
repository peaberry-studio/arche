import { AutopilotRunTrigger } from '@prisma/client'

import { formatAutopilotRunDate } from '@/lib/autopilot/cron'
import { planAutopilotRetry } from '@/lib/autopilot/retry-policy'
import { createInstanceClient } from '@/lib/opencode/client'
import {
  ensureWorkspaceRunningForExecution,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { auditService, autopilotService, instanceService, userService } from '@/lib/services'
import type { AutopilotClaimedTask } from '@/lib/services/autopilot'

const LEASE_EXTENSION_INTERVAL_MS = 60_000
export const AUTOPILOT_TASK_LEASE_MS = 15 * 60 * 1000

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

function buildAutopilotSessionTitle(task: AutopilotClaimedTask, scheduledFor: Date): string {
  return `Autopilot | ${task.name} | ${formatAutopilotRunDate(scheduledFor, task.timezone)}`
}

export async function runClaimedAutopilotTask(
  task: AutopilotClaimedTask,
  trigger: AutopilotRunTrigger,
): Promise<void> {
  const attempt = task.retryAttempt + 1
  const originalScheduledFor = task.retryScheduledFor ?? task.scheduledFor
  const run = await autopilotService.createRun({
    attempt,
    taskId: task.id,
    trigger,
    scheduledFor: task.scheduledFor,
  })

  let finishedAt = new Date()
  let sessionId: string | null = null
  let slug: string | null = null
  let sessionTitle: string | null = null
  let promptSent = false

  const buildAuditMetadata = (extra: Record<string, unknown> = {}) => ({
    attempt,
    runId: run.id,
    sessionId,
    originalScheduledFor: originalScheduledFor.toISOString(),
    scheduledFor: task.scheduledFor.toISOString(),
    taskId: task.id,
    trigger,
    userId: task.userId,
    ...(slug ? { slug } : {}),
    ...extra,
  })

  const markFailed = async (detail: string, failedAt: Date) => {
    const retryPlan = planAutopilotRetry({
      error: detail,
      now: failedAt,
      promptSent,
      retryAttempt: task.retryAttempt,
      trigger,
    })

    await autopilotService.markRunFailed(run.id, {
      error: detail,
      finishedAt: failedAt,
      openCodeSessionId: sessionId,
      sessionTitle,
    })

    if (retryPlan.ok) {
      await autopilotService.scheduleTaskRetry({
        leaseOwner: task.leaseOwner ?? '',
        retryAttempt: retryPlan.nextRetryAttempt,
        retryAt: retryPlan.retryAt,
        retryScheduledFor: originalScheduledFor,
        taskId: task.id,
      })

      console.warn('[autopilot] Retry scheduled', {
        attempt,
        error: detail,
        maxAttempts: retryPlan.maxAttempts,
        retryAt: retryPlan.retryAt.toISOString(),
        taskId: task.id,
      })

      await auditService.createEvent({
        actorUserId: task.userId,
        action: 'autopilot.run_failed',
        metadata: buildAuditMetadata({
          error: detail,
          maxAttempts: retryPlan.maxAttempts,
          retryAt: retryPlan.retryAt.toISOString(),
          willRetry: true,
        }),
      })
      return
    }

    if (task.retryAttempt > 0 || task.retryScheduledFor) {
      await autopilotService.clearTaskRetryState(task.id, task.leaseOwner ?? '').catch(() => undefined)
    }

    await auditService.createEvent({
      actorUserId: task.userId,
      action: 'autopilot.run_failed',
      metadata: buildAuditMetadata({
        error: detail,
        maxAttempts: retryPlan.maxAttempts,
        retryReason: retryPlan.reason,
        willRetry: false,
      }),
    })
  }

  try {
    const owner = await userService.findByIdSelect(task.userId, { slug: true })
    if (!owner) {
      throw new Error('autopilot_user_not_found')
    }

    slug = owner.slug
    await ensureWorkspaceRunningForExecution(slug, task.userId)

    await instanceService.touchActivity(slug).catch(() => undefined)

    const client = await createInstanceClient(slug)
    if (!client) {
      throw new Error('instance_unavailable')
    }

    sessionTitle = buildAutopilotSessionTitle(task, task.scheduledFor)
    const sessionResult = await client.session.create(
      { title: sessionTitle },
      { throwOnError: true },
    )
    if (!sessionResult.data) {
      throw new Error('autopilot_session_create_failed')
    }

    sessionId = sessionResult.data.id
    await autopilotService.attachRunSession(run.id, {
      openCodeSessionId: sessionId,
      sessionTitle,
    })

    promptSent = true
    await client.session.promptAsync(
      {
        sessionID: sessionId,
        agent: task.targetAgentId ?? undefined,
        parts: [
          {
            type: 'text',
            text: task.prompt,
          },
        ],
      },
      { throwOnError: true },
    )

    let lastLeaseExtensionAt = 0
    const failure = await waitForSessionToComplete({
      client,
      sessionId,
      slug,
      onPulse: async () => {
        if (Date.now() - lastLeaseExtensionAt < LEASE_EXTENSION_INTERVAL_MS) {
          return
        }

        await autopilotService.extendTaskLease(
          task.id,
          task.leaseOwner ?? '',
          new Date(Date.now() + AUTOPILOT_TASK_LEASE_MS),
        )
        lastLeaseExtensionAt = Date.now()
      },
    })

    const completedAt = new Date()
    finishedAt = completedAt
    if (failure) {
      await markFailed(failure, completedAt)
    } else {
      if (task.retryAttempt > 0 || task.retryScheduledFor) {
        await autopilotService.clearTaskRetryState(task.id, task.leaseOwner ?? '').catch(() => undefined)
      }

      await autopilotService.markRunSucceeded(run.id, {
        finishedAt: completedAt,
        openCodeSessionId: sessionId,
        sessionTitle,
      })
      await auditService.createEvent({
        actorUserId: task.userId,
        action: 'autopilot.run_succeeded',
        metadata: buildAuditMetadata(),
      })
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'autopilot_run_failed'
    finishedAt = new Date()
    await markFailed(detail, finishedAt).catch(() => undefined)
  } finally {
    await autopilotService.releaseTaskLease(
      task.id,
      task.leaseOwner ?? '',
      finishedAt,
    ).catch(() => undefined)
  }
}

export async function triggerAutopilotTaskNow(params: {
  taskId: string
  trigger: AutopilotRunTrigger
  userId?: string
}): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'task_busy' }> {
  const now = new Date()
  const leaseOwner = await createLeaseOwner()
  const claimed = await autopilotService.claimTaskForImmediateRun({
    id: params.taskId,
    leaseMs: AUTOPILOT_TASK_LEASE_MS,
    leaseOwner,
    now,
    userId: params.userId,
  })

  if (!claimed) {
    const task = params.userId
      ? await autopilotService.findTaskByIdAndUserId(params.taskId, params.userId)
      : null
    if (!task && params.userId) {
      return { ok: false, error: 'not_found' }
    }

    return { ok: false, error: 'task_busy' }
  }

  void runClaimedAutopilotTask(claimed, params.trigger).catch((error) => {
    console.error('[autopilot] Failed to execute immediate task run', {
      taskId: claimed.id,
      error,
      trigger: params.trigger,
    })
  })

  return { ok: true }
}
