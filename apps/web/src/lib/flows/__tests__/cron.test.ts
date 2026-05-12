import { describe, expect, it } from 'vitest'

import {
  assertValidFlowTimeZone,
  getNextFlowRunAt,
  isValidFlowTimeZone,
  normalizeFlowCronExpression,
  validateFlowCronExpression,
} from '@/lib/flows/cron'

describe('flow cron helpers', () => {
  it('normalizes and validates cron expressions', () => {
    expect(normalizeFlowCronExpression(' 0   9  *   *  1 ')).toBe('0 9 * * 1')
    expect(validateFlowCronExpression(' 0   9  *   *  1 ', 'UTC')).toBe('0 9 * * 1')
  })

  it('rejects invalid timezones and malformed cron expressions', () => {
    expect(isValidFlowTimeZone('')).toBe(false)
    expect(() => assertValidFlowTimeZone('Not/AZone')).toThrow('invalid_timezone')
    expect(() => validateFlowCronExpression('* * *', 'UTC')).toThrow('invalid_cron_expression')
  })

  it('computes the next run date', () => {
    expect(getNextFlowRunAt('0 9 * * 1', 'UTC', new Date('2026-05-12T10:00:00.000Z')).toISOString())
      .toBe('2026-05-18T09:00:00.000Z')
  })
})
