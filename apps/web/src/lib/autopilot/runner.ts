import { AutopilotRunTrigger } from '@prisma/client'

import { formatAutopilotRunDate } from '@/lib/autopilot/cron'
import { createInstanceClient } from '@/lib/opencode/client'
import { transformParts } from '@/lib/opencode/transform'
import { auditService, autopilotService, instanceService, userService } from '@/lib/services'
import { getInstanceStatus, startInstance } from '@/lib/spawner/core'
import type { AutopilotClaimedTask } from '@/lib/services/autopilot'
import { deriveWorkspaceMessageRuntimeState } from '@/lib/workspace-message-state'

const RUN_POLL_INTERVAL_MS = 2_000
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const ACTIVITY_TOUCH_INTERVAL_MS = 20_000
const LEASE_EXTENSION_INTERVAL_MS = 60_000
const INSTANCE_START_POLL_INTERVAL_MS = 2_000
const IDLE_WITHOUT_ASSISTANT_GRACE_MS = 15_000
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildAutopilotSessionTitle(task: AutopilotClaimedTask, scheduledFor: Date): string {
  return `Autopilot | ${task.name} | ${formatAutopilotRunDate(scheduledFor, task.timezone)}`
}

function normalizeRole(role: unknown): 'assistant' | 'system' | 'user' | null {
  if (role === 'assistant' || role === 'system' || role === 'user') {
    return role
  }

  return null
}

async function ensureWorkspaceRunningForAutopilot(slug: string, userId: string): Promise<void> {
  const current = await getInstanceStatus(slug)
  if (current?.status === 'running') {
    return
  }

  if (current?.status === 'starting') {
    const deadline = Date.now() + RUN_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(INSTANCE_START_POLL_INTERVAL_MS)
      const next = await getInstanceStatus(slug)
      if (next?.status === 'running') {
        return
      }
    }

    throw new Error('instance_start_timeout')
  }

  const startResult = await startInstance(slug, userId)
  if (!startResult.ok && startResult.error !== 'already_running') {
    throw new Error(startResult.detail ?? startResult.error)
  }
}

async function inspectSessionOutcome(client: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>, sessionId: string): Promise<string | null> {
  const response = await client.session.messages(
    { sessionID: sessionId },
    { throwOnError: true },
  )
  const messages = response.data ?? []
  const assistantMessages = messages.filter((message) => normalizeRole(message.info.role) === 'assistant')

  if (assistantMessages.length === 0) {
    return 'autopilot_no_assistant_message'
  }

  const latestAssistant = assistantMessages[assistantMessages.length - 1]
  const completedAt = (latestAssistant.info.time as { completed?: number } | undefined)?.completed
  const parts = transformParts(latestAssistant.parts ?? [])
  const runtimeState = deriveWorkspaceMessageRuntimeState({
    role: 'assistant',
    completedAt,
    parts,
    sessionStatus: 'idle',
  })

  if (runtimeState.pending) {
    return 'autopilot_session_pending'
  }

  if (runtimeState.statusInfo?.status === 'error') {
    return runtimeState.statusInfo.detail ?? 'autopilot_run_failed'
  }

  return null
}

async function waitForSessionToComplete(params: {
  client: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
  leaseOwner: string
  scheduledTask: AutopilotClaimedTask
  sessionId: string
  slug: string
}): Promise<string | null> {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  const startedAt = Date.now()
  let lastActivityTouchAt = 0
  let lastLeaseExtensionAt = 0
  let assistantSeen = false

  while (Date.now() < deadline) {
    if (Date.now() - lastActivityTouchAt >= ACTIVITY_TOUCH_INTERVAL_MS) {
      await instanceService.touchActivity(params.slug).catch(() => undefined)
      lastActivityTouchAt = Date.now()
    }

    if (Date.now() - lastLeaseExtensionAt >= LEASE_EXTENSION_INTERVAL_MS) {
      await autopilotService.extendTaskLease(
        params.scheduledTask.id,
        params.leaseOwner,
        new Date(Date.now() + AUTOPILOT_TASK_LEASE_MS),
      ).catch(() => undefined)
      lastLeaseExtensionAt = Date.now()
    }

    const [statusResult, messagesResult] = await Promise.all([
      params.client.session.status({}, { throwOnError: true }),
      params.client.session.messages({ sessionID: params.sessionId }, { throwOnError: true }),
    ])

    const sessionStatus = statusResult.data?.[params.sessionId]
    const messages = messagesResult.data ?? []
    assistantSeen = assistantSeen || messages.some((message) => normalizeRole(message.info.role) === 'assistant')

    if ((sessionStatus?.type === 'idle' || !sessionStatus) && assistantSeen) {
      const outcome = await inspectSessionOutcome(params.client, params.sessionId)
      if (outcome === 'autopilot_session_pending') {
        await sleep(RUN_POLL_INTERVAL_MS)
        continue
      }

      return outcome
    }

    if (
      (sessionStatus?.type === 'idle' || !sessionStatus) &&
      !assistantSeen &&
      Date.now() - startedAt >= IDLE_WITHOUT_ASSISTANT_GRACE_MS
    ) {
      return 'autopilot_no_assistant_message'
    }

    await sleep(RUN_POLL_INTERVAL_MS)
  }

  return 'autopilot_run_timeout'
}

export async function runClaimedAutopilotTask(
  task: AutopilotClaimedTask,
  trigger: AutopilotRunTrigger,
): Promise<void> {
  const run = await autopilotService.createRun({
    taskId: task.id,
    trigger,
    scheduledFor: task.scheduledFor,
  })

  let finishedAt = new Date()
  let sessionId: string | null = null
  let slug: string | null = null
  let sessionTitle: string | null = null

  const buildAuditMetadata = (extra: Record<string, unknown> = {}) => ({
    runId: run.id,
    sessionId,
    taskId: task.id,
    trigger,
    userId: task.userId,
    ...(slug ? { slug } : {}),
    ...extra,
  })

  try {
    const owner = await userService.findByIdSelect(task.userId, { slug: true })
    if (!owner) {
      throw new Error('autopilot_user_not_found')
    }

    slug = owner.slug
    await ensureWorkspaceRunningForAutopilot(slug, task.userId)

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

    const failure = await waitForSessionToComplete({
      client,
      leaseOwner: task.leaseOwner ?? '',
      scheduledTask: task,
      sessionId,
      slug,
    })

    const completedAt = new Date()
    finishedAt = completedAt
    if (failure) {
      await autopilotService.markRunFailed(run.id, {
        error: failure,
        finishedAt: completedAt,
        openCodeSessionId: sessionId,
        sessionTitle,
      })
      await auditService.createEvent({
        actorUserId: task.userId,
        action: 'autopilot.run_failed',
        metadata: buildAuditMetadata({ error: failure }),
      })
    } else {
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
    await autopilotService.markRunFailed(run.id, {
      error: detail,
      finishedAt,
      openCodeSessionId: sessionId,
      sessionTitle,
    }).catch(() => undefined)
    await auditService.createEvent({
      actorUserId: task.userId,
      action: 'autopilot.run_failed',
      metadata: buildAuditMetadata({ error: detail }),
    })
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
