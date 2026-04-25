import { triggerAutopilotTaskNow } from '@/lib/autopilot/runner'
import type { RuntimeUser } from '@/lib/runtime/types'
import { autopilotService } from '@/lib/services'
import type { AutopilotRunRecord, AutopilotTaskListRecord } from '@/lib/services/autopilot'

type AutopilotTaskForMcp = {
  id: string
  name: string
  enabled: boolean
  targetAgentId: string | null
  nextRunAt: string
  lastRunAt: string | null
  latestRun: AutopilotRunForMcp | null
}

type AutopilotRunForMcp = {
  id: string
  status: string
  trigger: string
  startedAt: string
  finishedAt: string | null
  error: string | null
}

type ListAutopilotTasksInput = {
  user?: RuntimeUser
}

type RunAutopilotTaskInput = {
  id: string
  user?: RuntimeUser
}

export async function listAutopilotTasksForMcp(
  input: ListAutopilotTasksInput
): Promise<
  | { ok: true; tasks: AutopilotTaskForMcp[] }
  | { ok: false; error: 'not_authenticated' }
> {
  if (!input.user) {
    return { ok: false, error: 'not_authenticated' }
  }

  const tasks = await autopilotService.listTasksByUserId(input.user.id)
  return {
    ok: true,
    tasks: tasks.map(serializeTask),
  }
}

export async function runAutopilotTaskForMcp(
  input: RunAutopilotTaskInput
): Promise<
  | { ok: true }
  | { ok: false; error: 'not_authenticated' | 'not_found' | 'task_busy' }
> {
  if (!input.user) {
    return { ok: false, error: 'not_authenticated' }
  }

  return triggerAutopilotTaskNow({
    taskId: input.id,
    trigger: 'manual',
    userId: input.user.id,
  })
}

function serializeTask(task: AutopilotTaskListRecord): AutopilotTaskForMcp {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    targetAgentId: task.targetAgentId,
    nextRunAt: task.nextRunAt.toISOString(),
    lastRunAt: task.lastRunAt ? task.lastRunAt.toISOString() : null,
    latestRun: serializeRun(task.runs[0]),
  }
}

function serializeRun(run: AutopilotRunRecord | undefined): AutopilotRunForMcp | null {
  if (!run) {
    return null
  }

  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    error: run.error,
  }
}
