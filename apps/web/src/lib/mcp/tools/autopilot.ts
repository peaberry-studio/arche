import { FlowRunTrigger } from '@prisma/client'

import { triggerFlowNow } from '@/lib/flows/runner'
import type { RuntimeUser } from '@/lib/runtime/types'
import { flowService } from '@/lib/services'
import type { FlowListRecord, FlowRunRecord } from '@/lib/services/flow'

type AutopilotTaskForMcp = {
  id: string
  name: string
  enabled: boolean
  targetAgentId: string | null
  nextRunAt: string | null
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

  const tasks = await flowService.listFlowsByUserId(input.user.id)
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

  const result = await triggerFlowNow({
    flowId: input.id,
    trigger: FlowRunTrigger.manual,
    userId: input.user.id,
  })

  if (result.ok) {
    return result
  }

  if (result.error === 'flow_busy') {
    return { ok: false, error: 'task_busy' }
  }

  return { ok: false, error: 'not_found' }
}

function serializeTask(task: FlowListRecord): AutopilotTaskForMcp {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    targetAgentId: null,
    nextRunAt: task.nextRunAt ? task.nextRunAt.toISOString() : null,
    lastRunAt: task.lastRunAt ? task.lastRunAt.toISOString() : null,
    latestRun: serializeRun(task.runs[0]),
  }
}

function serializeRun(run: FlowRunRecord | undefined): AutopilotRunForMcp | null {
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
