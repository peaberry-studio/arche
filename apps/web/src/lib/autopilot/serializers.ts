import type { AutopilotTaskListItem, AutopilotRunListItem, AutopilotTaskDetail } from '@/lib/autopilot/types'
import type { AutopilotRunRecord, AutopilotTaskDetailRecord, AutopilotTaskListRecord } from '@/lib/services/autopilot'

function serializeRun(run: AutopilotRunRecord | null | undefined): AutopilotRunListItem | null {
  if (!run) return null

  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    scheduledFor: run.scheduledFor.toISOString(),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    error: run.error,
    openCodeSessionId: run.openCodeSessionId,
    sessionTitle: run.sessionTitle,
  }
}

export function serializeAutopilotTaskListItem(task: AutopilotTaskListRecord): AutopilotTaskListItem {
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    targetAgentId: task.targetAgentId,
    cronExpression: task.cronExpression,
    timezone: task.timezone,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt.toISOString(),
    lastRunAt: task.lastRunAt ? task.lastRunAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    latestRun: serializeRun(task.runs[0]),
  }
}

export function serializeAutopilotTaskDetail(task: AutopilotTaskDetailRecord): AutopilotTaskDetail {
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    targetAgentId: task.targetAgentId,
    cronExpression: task.cronExpression,
    timezone: task.timezone,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt.toISOString(),
    lastRunAt: task.lastRunAt ? task.lastRunAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    latestRun: serializeRun(task.runs[0]),
    runs: task.runs.map((run) => serializeRun(run)).filter((run): run is AutopilotRunListItem => run !== null),
  }
}
