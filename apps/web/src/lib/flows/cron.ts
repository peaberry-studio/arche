import { CronExpressionParser } from 'cron-parser'

export function normalizeFlowCronExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, ' ')
}

export function isValidFlowTimeZone(timezone: string): boolean {
  const normalized = timezone.trim()
  if (!normalized) return false

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function assertValidFlowTimeZone(timezone: string): string {
  const normalized = timezone.trim()
  if (!isValidFlowTimeZone(normalized)) {
    throw new Error('invalid_timezone')
  }

  return normalized
}

export function validateFlowCronExpression(expression: string, timezone: string): string {
  const normalizedExpression = normalizeFlowCronExpression(expression)
  const normalizedTimezone = assertValidFlowTimeZone(timezone)
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

export function getNextFlowRunAt(expression: string, timezone: string, fromDate: Date): Date {
  const normalizedExpression = validateFlowCronExpression(expression, timezone)
  const iterator = CronExpressionParser.parse(normalizedExpression, {
    currentDate: fromDate,
    strict: false,
    tz: timezone,
  })

  return iterator.next().toDate()
}

export function formatFlowRunDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date)
}

export function getFlowTimeZoneOptions(): string[] {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      // Fall through to the fallback list.
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
