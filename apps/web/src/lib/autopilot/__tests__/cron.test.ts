import { describe, expect, it } from 'vitest'

import {
  buildAutopilotCronExpressionFromBuilder,
  getNextAutopilotRunAt,
  getUpcomingAutopilotRunDates,
  inferAutopilotScheduleBuilderState,
  validateAutopilotCronExpression,
} from '@/lib/autopilot/cron'

describe('autopilot cron helpers', () => {
  it('builds cron expressions from daily builder state', () => {
    expect(
      buildAutopilotCronExpressionFromBuilder({
        mode: 'daily',
        intervalDays: 3,
        hour: 9,
        minute: 15,
      })
    ).toBe('15 9 */3 * *')
  })

  it('infers known cron expressions back into builder state', () => {
    expect(inferAutopilotScheduleBuilderState('0 8 * * 1,3,5')).toEqual({
      mode: 'weekly',
      weekdays: [1, 3, 5],
      hour: 8,
      minute: 0,
    })
  })

  it('validates cron expressions with timezone support', () => {
    expect(validateAutopilotCronExpression('0 9 * * 1-5', 'Europe/Madrid')).toBe('0 9 * * 1-5')
    expect(() => validateAutopilotCronExpression('invalid cron', 'Europe/Madrid')).toThrow(
      'invalid_cron_expression'
    )
    expect(() => validateAutopilotCronExpression('0 9 * * 1-5', 'Mars/Olympus')).toThrow(
      'invalid_timezone'
    )
  })

  it('computes upcoming run dates deterministically', () => {
    const fromDate = new Date('2026-04-12T07:30:00.000Z')

    const next = getNextAutopilotRunAt('0 9 * * *', 'UTC', fromDate)
    expect(next.toISOString()).toBe('2026-04-12T09:00:00.000Z')

    const upcoming = getUpcomingAutopilotRunDates('0 9 * * *', 'UTC', fromDate, 3)
    expect(upcoming.map((entry) => entry.toISOString())).toEqual([
      '2026-04-12T09:00:00.000Z',
      '2026-04-13T09:00:00.000Z',
      '2026-04-14T09:00:00.000Z',
    ])
  })
})
