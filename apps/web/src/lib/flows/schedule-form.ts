import {
  getUpcomingFlowRunDates,
  normalizeFlowCronExpression,
} from '@/lib/flows/cron'

export type FlowScheduleBuilderMode = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

export type FlowScheduleBuilderState =
  | { mode: 'minutes'; intervalMinutes: number }
  | { mode: 'hourly'; intervalHours: number; minute: number }
  | { mode: 'daily'; intervalDays: number; hour: number; minute: number }
  | { mode: 'weekly'; weekdays: number[]; hour: number; minute: number }
  | { mode: 'monthly'; intervalMonths: number; dayOfMonth: number; hour: number; minute: number }
  | { mode: 'custom'; cronExpression: string }

export type FlowScheduleFormState = {
  customCronExpression: string
  dayOfMonth: number
  hour: number
  intervalDays: number
  intervalHours: number
  intervalMinutes: number
  intervalMonths: number
  minute: number
  mode: FlowScheduleBuilderMode
  weekdays: number[]
}

export type FlowSchedulePreview = {
  cronExpression: string
  isValid: boolean
  nextRuns: Date[]
}

export const FLOW_WEEKDAY_OPTIONS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
]

const DEFAULT_BUILDER_STATE: FlowScheduleBuilderState = {
  hour: 9,
  intervalDays: 1,
  minute: 0,
  mode: 'daily',
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback
  return Math.floor(value)
}

function normalizeBoundedInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function isIntegerToken(value: string): boolean {
  return /^\d+$/.test(value)
}

function isStepToken(value: string): boolean {
  return /^\*\/\d+$/.test(value)
}

function parseStepToken(value: string): number | null {
  if (!isStepToken(value)) return null
  return Number.parseInt(value.slice(2), 10)
}

function parseIntegerToken(value: string): number | null {
  if (!isIntegerToken(value)) return null
  return Number.parseInt(value, 10)
}

function parseWeekdayList(value: string): number[] | null {
  const tokens = value.split(',').map((token) => token.trim()).filter((token) => token.length > 0)
  if (tokens.length === 0) return null

  const weekdays = new Set<number>()
  for (const token of tokens) {
    if (!isIntegerToken(token)) return null

    const weekday = Number.parseInt(token, 10)
    if (weekday < 0 || weekday > 6) return null

    weekdays.add(weekday)
  }

  return Array.from(weekdays).sort((left, right) => left - right)
}

function toScheduleFormState(builder: FlowScheduleBuilderState): FlowScheduleFormState {
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

function toBuilderState(state: FlowScheduleFormState): FlowScheduleBuilderState {
  switch (state.mode) {
    case 'minutes':
      return { intervalMinutes: state.intervalMinutes, mode: state.mode }
    case 'hourly':
      return { intervalHours: state.intervalHours, minute: state.minute, mode: state.mode }
    case 'daily':
      return {
        hour: state.hour,
        intervalDays: state.intervalDays,
        minute: state.minute,
        mode: state.mode,
      }
    case 'weekly':
      return {
        hour: state.hour,
        minute: state.minute,
        mode: state.mode,
        weekdays: state.weekdays,
      }
    case 'monthly':
      return {
        dayOfMonth: state.dayOfMonth,
        hour: state.hour,
        intervalMonths: state.intervalMonths,
        minute: state.minute,
        mode: state.mode,
      }
    case 'custom':
      return { cronExpression: state.customCronExpression, mode: state.mode }
  }
}

export function buildFlowCronExpressionFromBuilder(state: FlowScheduleBuilderState): string {
  switch (state.mode) {
    case 'minutes': {
      const intervalMinutes = normalizePositiveInteger(state.intervalMinutes, 15)
      if (intervalMinutes === 1) return '* * * * *'
      return `*/${intervalMinutes} * * * *`
    }

    case 'hourly': {
      const intervalHours = normalizePositiveInteger(state.intervalHours, 1)
      const minute = normalizeBoundedInteger(state.minute, 0, 59, 0)
      return `${minute} */${intervalHours} * * *`
    }

    case 'daily': {
      const intervalDays = normalizePositiveInteger(state.intervalDays, 1)
      const hour = normalizeBoundedInteger(state.hour, 0, 23, 9)
      const minute = normalizeBoundedInteger(state.minute, 0, 59, 0)
      return `${minute} ${hour} */${intervalDays} * *`
    }

    case 'weekly': {
      const weekdays = Array.from(new Set(state.weekdays))
        .map((weekday) => normalizeBoundedInteger(weekday, 0, 6, 1))
        .sort((left, right) => left - right)
      const hour = normalizeBoundedInteger(state.hour, 0, 23, 9)
      const minute = normalizeBoundedInteger(state.minute, 0, 59, 0)
      const dayOfWeek = weekdays.length > 0 ? weekdays.join(',') : '1'
      return `${minute} ${hour} * * ${dayOfWeek}`
    }

    case 'monthly': {
      const intervalMonths = normalizePositiveInteger(state.intervalMonths, 1)
      const dayOfMonth = normalizeBoundedInteger(state.dayOfMonth, 1, 31, 1)
      const hour = normalizeBoundedInteger(state.hour, 0, 23, 9)
      const minute = normalizeBoundedInteger(state.minute, 0, 59, 0)
      return `${minute} ${hour} ${dayOfMonth} */${intervalMonths} *`
    }

    case 'custom':
      return normalizeFlowCronExpression(state.cronExpression)
  }
}

export function inferFlowScheduleBuilderState(expression: string): FlowScheduleBuilderState {
  const normalizedExpression = normalizeFlowCronExpression(expression)
  if (!normalizedExpression) return DEFAULT_BUILDER_STATE

  const parts = normalizedExpression.split(' ')
  if (parts.length !== 5) return { cronExpression: normalizedExpression, mode: 'custom' }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { intervalMinutes: parseStepToken(minute) ?? 1, mode: 'minutes' }
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHourStep = parseStepToken(hour)
    if (parsedMinute !== null && parsedHourStep !== null) {
      return { intervalHours: parsedHourStep, minute: parsedMinute, mode: 'hourly' }
    }
  }

  if (month === '*' && dayOfWeek === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHour = parseIntegerToken(hour)
    const parsedDayStep = parseStepToken(dayOfMonth)
    if (parsedMinute !== null && parsedHour !== null && parsedDayStep !== null) {
      return {
        hour: parsedHour,
        intervalDays: parsedDayStep,
        minute: parsedMinute,
        mode: 'daily',
      }
    }
  }

  if (dayOfMonth === '*' && month === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHour = parseIntegerToken(hour)
    const parsedWeekdays = parseWeekdayList(dayOfWeek)
    if (parsedMinute !== null && parsedHour !== null && parsedWeekdays) {
      return { hour: parsedHour, minute: parsedMinute, mode: 'weekly', weekdays: parsedWeekdays }
    }
  }

  if (dayOfWeek === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHour = parseIntegerToken(hour)
    const parsedDayOfMonth = parseIntegerToken(dayOfMonth)
    const parsedMonthStep = parseStepToken(month)
    if (parsedMinute !== null && parsedHour !== null && parsedDayOfMonth !== null && parsedMonthStep !== null) {
      return {
        dayOfMonth: parsedDayOfMonth,
        hour: parsedHour,
        intervalMonths: parsedMonthStep,
        minute: parsedMinute,
        mode: 'monthly',
      }
    }
  }

  return { cronExpression: normalizedExpression, mode: 'custom' }
}

export function getDefaultFlowScheduleFormState(): FlowScheduleFormState {
  return toScheduleFormState(DEFAULT_BUILDER_STATE)
}

export function inferFlowScheduleFormState(expression: string | null): FlowScheduleFormState {
  return toScheduleFormState(inferFlowScheduleBuilderState(expression ?? ''))
}

export function buildFlowCronExpressionFromFormState(state: FlowScheduleFormState): string {
  return buildFlowCronExpressionFromBuilder(toBuilderState(state))
}

export function getFlowSchedulePreview(state: FlowScheduleFormState, timezone: string): FlowSchedulePreview {
  const cronExpression = buildFlowCronExpressionFromFormState(state)

  try {
    const nextRuns = getUpcomingFlowRunDates(cronExpression, timezone, new Date(), 3)
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
