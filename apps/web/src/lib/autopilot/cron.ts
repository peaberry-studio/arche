import { CronExpressionParser } from 'cron-parser'

import type { AutopilotScheduleBuilderState } from '@/lib/autopilot/types'

const DEFAULT_BUILDER_STATE: AutopilotScheduleBuilderState = {
  mode: 'daily',
  intervalDays: 1,
  hour: 9,
  minute: 0,
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
    if (!isIntegerToken(token)) {
      return null
    }

    const weekday = Number.parseInt(token, 10)
    if (weekday < 0 || weekday > 6) {
      return null
    }

    weekdays.add(weekday)
  }

  return Array.from(weekdays).sort((left, right) => left - right)
}

export function normalizeAutopilotCronExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, ' ')
}

export function isValidAutopilotTimeZone(timezone: string): boolean {
  const normalized = timezone.trim()
  if (!normalized) return false

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function assertValidAutopilotTimeZone(timezone: string): string {
  const normalized = timezone.trim()
  if (!isValidAutopilotTimeZone(normalized)) {
    throw new Error('invalid_timezone')
  }

  return normalized
}

export function validateAutopilotCronExpression(expression: string, timezone: string): string {
  const normalizedExpression = normalizeAutopilotCronExpression(expression)
  const normalizedTimezone = assertValidAutopilotTimeZone(timezone)
  const fields = normalizedExpression.split(' ')

  if (fields.length !== 5) {
    throw new Error('invalid_cron_expression')
  }

  CronExpressionParser.parse(normalizedExpression, {
    currentDate: new Date(),
    strict: false,
    tz: normalizedTimezone,
  })

  return normalizedExpression
}

export function getNextAutopilotRunAt(expression: string, timezone: string, fromDate: Date): Date {
  const normalizedExpression = validateAutopilotCronExpression(expression, timezone)
  const iterator = CronExpressionParser.parse(normalizedExpression, {
    currentDate: fromDate,
    strict: false,
    tz: timezone,
  })

  return iterator.next().toDate()
}

export function getUpcomingAutopilotRunDates(
  expression: string,
  timezone: string,
  fromDate: Date,
  count: number,
): Date[] {
  const normalizedExpression = validateAutopilotCronExpression(expression, timezone)
  const iterator = CronExpressionParser.parse(normalizedExpression, {
    currentDate: fromDate,
    strict: false,
    tz: timezone,
  })

  return iterator.take(Math.max(0, Math.floor(count))).map((entry) => entry.toDate())
}

export function getAutopilotTimeZoneOptions(): string[] {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      // Fall through to the curated fallback list below.
    }
  }

  return [
    'UTC',
    'Europe/Madrid',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Australia/Sydney',
  ]
}

export function formatAutopilotRunDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date)
}

export function buildAutopilotCronExpressionFromBuilder(state: AutopilotScheduleBuilderState): string {
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
      return normalizeAutopilotCronExpression(state.cronExpression)
  }
}

export function inferAutopilotScheduleBuilderState(expression: string): AutopilotScheduleBuilderState {
  const normalizedExpression = normalizeAutopilotCronExpression(expression)
  const parts = normalizedExpression.split(' ')

  if (parts.length !== 5) {
    return { mode: 'custom', cronExpression: normalizedExpression }
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return {
      mode: 'minutes',
      intervalMinutes: parseStepToken(minute) ?? 1,
    }
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHourStep = parseStepToken(hour)
    if (parsedMinute !== null && parsedHourStep !== null) {
      return {
        mode: 'hourly',
        intervalHours: parsedHourStep,
        minute: parsedMinute,
      }
    }
  }

  if (month === '*' && dayOfWeek === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHour = parseIntegerToken(hour)
    const parsedDayStep = parseStepToken(dayOfMonth)
    if (parsedMinute !== null && parsedHour !== null && parsedDayStep !== null) {
      return {
        mode: 'daily',
        intervalDays: parsedDayStep,
        hour: parsedHour,
        minute: parsedMinute,
      }
    }
  }

  if (dayOfMonth === '*' && month === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHour = parseIntegerToken(hour)
    const parsedWeekdays = parseWeekdayList(dayOfWeek)
    if (parsedMinute !== null && parsedHour !== null && parsedWeekdays) {
      return {
        mode: 'weekly',
        weekdays: parsedWeekdays,
        hour: parsedHour,
        minute: parsedMinute,
      }
    }
  }

  if (dayOfWeek === '*') {
    const parsedMinute = parseIntegerToken(minute)
    const parsedHour = parseIntegerToken(hour)
    const parsedDayOfMonth = parseIntegerToken(dayOfMonth)
    const parsedMonthStep = parseStepToken(month)
    if (
      parsedMinute !== null &&
      parsedHour !== null &&
      parsedDayOfMonth !== null &&
      parsedMonthStep !== null
    ) {
      return {
        mode: 'monthly',
        intervalMonths: parsedMonthStep,
        dayOfMonth: parsedDayOfMonth,
        hour: parsedHour,
        minute: parsedMinute,
      }
    }
  }

  return { mode: 'custom', cronExpression: normalizedExpression }
}

export function createDefaultAutopilotScheduleBuilderState(): AutopilotScheduleBuilderState {
  return DEFAULT_BUILDER_STATE
}
