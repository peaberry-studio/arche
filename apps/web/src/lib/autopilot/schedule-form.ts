import {
  buildAutopilotCronExpressionFromBuilder,
  createDefaultAutopilotScheduleBuilderState,
  getUpcomingAutopilotRunDates,
  inferAutopilotScheduleBuilderState,
} from '@/lib/autopilot/cron'
import type {
  AutopilotScheduleBuilderMode,
  AutopilotScheduleBuilderState,
} from '@/lib/autopilot/types'

export type AutopilotScheduleFormState = {
  customCronExpression: string
  dayOfMonth: number
  hour: number
  intervalDays: number
  intervalHours: number
  intervalMinutes: number
  intervalMonths: number
  minute: number
  mode: AutopilotScheduleBuilderMode
  weekdays: number[]
}

export type AutopilotSchedulePreview = {
  cronExpression: string
  isValid: boolean
  nextRuns: Date[]
}

export const AUTOPILOT_WEEKDAY_OPTIONS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
]

function toScheduleFormState(builder: AutopilotScheduleBuilderState): AutopilotScheduleFormState {
  switch (builder.mode) {
    case 'minutes':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: 9,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: builder.intervalMinutes,
        intervalMonths: 1,
        minute: 0,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'hourly':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: 9,
        intervalDays: 1,
        intervalHours: builder.intervalHours,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'daily':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: builder.hour,
        intervalDays: builder.intervalDays,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'weekly':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: builder.hour,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: builder.weekdays,
      }
    case 'monthly':
      return {
        customCronExpression: '',
        dayOfMonth: builder.dayOfMonth,
        hour: builder.hour,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: builder.intervalMonths,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'custom':
      return {
        customCronExpression: builder.cronExpression,
        dayOfMonth: 1,
        hour: 9,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: 0,
        mode: builder.mode,
        weekdays: [1],
      }
  }
}

function toBuilderState(state: AutopilotScheduleFormState): AutopilotScheduleBuilderState {
  switch (state.mode) {
    case 'minutes':
      return { mode: state.mode, intervalMinutes: state.intervalMinutes }
    case 'hourly':
      return {
        mode: state.mode,
        intervalHours: state.intervalHours,
        minute: state.minute,
      }
    case 'daily':
      return {
        mode: state.mode,
        intervalDays: state.intervalDays,
        hour: state.hour,
        minute: state.minute,
      }
    case 'weekly':
      return {
        mode: state.mode,
        weekdays: state.weekdays,
        hour: state.hour,
        minute: state.minute,
      }
    case 'monthly':
      return {
        mode: state.mode,
        intervalMonths: state.intervalMonths,
        dayOfMonth: state.dayOfMonth,
        hour: state.hour,
        minute: state.minute,
      }
    case 'custom':
      return { mode: state.mode, cronExpression: state.customCronExpression }
  }
}

export function getDefaultAutopilotScheduleFormState(): AutopilotScheduleFormState {
  return toScheduleFormState(createDefaultAutopilotScheduleBuilderState())
}

export function inferAutopilotScheduleFormState(expression: string): AutopilotScheduleFormState {
  return toScheduleFormState(inferAutopilotScheduleBuilderState(expression))
}

export function buildAutopilotCronExpressionFromFormState(state: AutopilotScheduleFormState): string {
  return buildAutopilotCronExpressionFromBuilder(toBuilderState(state))
}

export function getAutopilotSchedulePreview(
  state: AutopilotScheduleFormState,
  timezone: string,
): AutopilotSchedulePreview {
  const cronExpression = buildAutopilotCronExpressionFromFormState(state)

  try {
    const nextRuns = getUpcomingAutopilotRunDates(cronExpression, timezone, new Date(), 3)
    return {
      cronExpression,
      isValid: nextRuns.length > 0,
      nextRuns,
    }
  } catch {
    return {
      cronExpression,
      isValid: false,
      nextRuns: [],
    }
  }
}
