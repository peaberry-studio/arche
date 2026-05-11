import type {
  AutopilotRunListItem,
  AutopilotSlackNotificationConfig,
  AutopilotSlackNotificationTarget,
  AutopilotTaskDetail,
  AutopilotTaskListItem,
} from '@/lib/autopilot/types'
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

export function serializeSlackNotificationConfig(
  value: unknown,
): AutopilotSlackNotificationConfig | undefined {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }

  const targetsRaw = Array.isArray(record.targets) ? record.targets : []
  const targets = targetsRaw.flatMap((targetRaw): AutopilotSlackNotificationTarget[] => {
    const target = asRecord(targetRaw)
    if (!target) {
      return []
    }

    if (target.type === 'dm' && typeof target.userId === 'string' && target.userId) {
      return [{ type: 'dm', userId: target.userId }]
    }

    if (target.type === 'channel' && typeof target.channelId === 'string' && target.channelId) {
      return [{ type: 'channel', channelId: target.channelId }]
    }

    return []
  })

  return {
    enabled: record.enabled === true,
    includeSessionLink: typeof record.includeSessionLink === 'boolean' ? record.includeSessionLink : true,
    targets,
  }
}

export function serializeAutopilotTaskListItem(task: AutopilotTaskListRecord): AutopilotTaskListItem {
  const slackNotificationConfig = serializeSlackNotificationConfig(task.slackNotificationConfig)

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
    ...(slackNotificationConfig ? { slackNotificationConfig } : {}),
  }
}

export function serializeAutopilotTaskDetail(task: AutopilotTaskDetailRecord): AutopilotTaskDetail {
  const slackNotificationConfig = serializeSlackNotificationConfig(task.slackNotificationConfig)

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
    ...(slackNotificationConfig ? { slackNotificationConfig } : {}),
  }
}
