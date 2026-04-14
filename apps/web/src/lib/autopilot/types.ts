export type AutopilotRunStatus = 'running' | 'succeeded' | 'failed'

export type AutopilotRunTrigger = 'on_create' | 'schedule' | 'manual'

export type AutopilotSessionMetadata = {
  runId: string
  taskId: string
  taskName: string
  trigger: AutopilotRunTrigger
}

export type AutopilotRunListItem = {
  id: string
  status: AutopilotRunStatus
  trigger: AutopilotRunTrigger
  scheduledFor: string
  startedAt: string
  finishedAt: string | null
  error: string | null
  openCodeSessionId: string | null
  sessionTitle: string | null
}

export type AutopilotTaskListItem = {
  id: string
  name: string
  prompt: string
  targetAgentId: string | null
  cronExpression: string
  timezone: string
  enabled: boolean
  nextRunAt: string
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
  latestRun: AutopilotRunListItem | null
}

export type AutopilotTaskDetail = AutopilotTaskListItem & {
  runs: AutopilotRunListItem[]
}

export type AutopilotTaskPayload = {
  name: string
  prompt: string
  targetAgentId: string | null
  cronExpression: string
  timezone: string
  enabled: boolean
}

export type AutopilotTaskRunRequest = {
  trigger?: AutopilotRunTrigger
}

export type AutopilotScheduleBuilderMode =
  | 'minutes'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom'

export type AutopilotScheduleBuilderState =
  | {
      mode: 'minutes'
      intervalMinutes: number
    }
  | {
      mode: 'hourly'
      intervalHours: number
      minute: number
    }
  | {
      mode: 'daily'
      intervalDays: number
      hour: number
      minute: number
    }
  | {
      mode: 'weekly'
      weekdays: number[]
      hour: number
      minute: number
    }
  | {
      mode: 'monthly'
      intervalMonths: number
      dayOfMonth: number
      hour: number
      minute: number
    }
  | {
      mode: 'custom'
      cronExpression: string
    }
