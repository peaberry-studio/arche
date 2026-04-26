import { describe, expect, it } from 'vitest'

import {
  AUTOPILOT_WEEKDAY_OPTIONS,
  buildAutopilotCronExpressionFromFormState,
  getAutopilotSchedulePreview,
  getDefaultAutopilotScheduleFormState,
  inferAutopilotScheduleFormState,
  type AutopilotScheduleFormState,
} from '@/lib/autopilot/schedule-form'

describe('getDefaultAutopilotScheduleFormState', () => {
  it('returns the default daily schedule form state', () => {
    const state = getDefaultAutopilotScheduleFormState()

    expect(state.mode).toBe('daily')
    expect(state.intervalDays).toBe(1)
    expect(state.hour).toBe(9)
    expect(state.minute).toBe(0)
  })
})

describe('AUTOPILOT_WEEKDAY_OPTIONS', () => {
  it('contains all 7 days of the week', () => {
    expect(AUTOPILOT_WEEKDAY_OPTIONS).toHaveLength(7)
    expect(AUTOPILOT_WEEKDAY_OPTIONS[0]).toEqual({ label: 'Sun', value: 0 })
    expect(AUTOPILOT_WEEKDAY_OPTIONS[6]).toEqual({ label: 'Sat', value: 6 })
  })
})

describe('inferAutopilotScheduleFormState', () => {
  it('infers minutes mode', () => {
    const state = inferAutopilotScheduleFormState('*/15 * * * *')

    expect(state.mode).toBe('minutes')
    expect(state.intervalMinutes).toBe(15)
    // Default values should be filled in for unused fields
    expect(state.hour).toBe(9)
    expect(state.minute).toBe(0)
    expect(state.intervalDays).toBe(1)
  })

  it('infers hourly mode', () => {
    const state = inferAutopilotScheduleFormState('30 */2 * * *')

    expect(state.mode).toBe('hourly')
    expect(state.intervalHours).toBe(2)
    expect(state.minute).toBe(30)
  })

  it('infers daily mode', () => {
    const state = inferAutopilotScheduleFormState('15 9 */3 * *')

    expect(state.mode).toBe('daily')
    expect(state.intervalDays).toBe(3)
    expect(state.hour).toBe(9)
    expect(state.minute).toBe(15)
  })

  it('infers weekly mode', () => {
    const state = inferAutopilotScheduleFormState('0 8 * * 1,3,5')

    expect(state.mode).toBe('weekly')
    expect(state.weekdays).toEqual([1, 3, 5])
    expect(state.hour).toBe(8)
    expect(state.minute).toBe(0)
  })

  it('infers monthly mode', () => {
    const state = inferAutopilotScheduleFormState('0 10 15 */2 *')

    expect(state.mode).toBe('monthly')
    expect(state.intervalMonths).toBe(2)
    expect(state.dayOfMonth).toBe(15)
    expect(state.hour).toBe(10)
    expect(state.minute).toBe(0)
  })

  it('infers custom mode for unrecognized patterns', () => {
    const state = inferAutopilotScheduleFormState('0 9 1-15 * 1-5')

    expect(state.mode).toBe('custom')
    expect(state.customCronExpression).toBe('0 9 1-15 * 1-5')
  })

  it('fills default form values for minutes mode', () => {
    const state = inferAutopilotScheduleFormState('*/5 * * * *')

    expect(state.dayOfMonth).toBe(1)
    expect(state.intervalHours).toBe(1)
    expect(state.intervalMonths).toBe(1)
    expect(state.weekdays).toEqual([1])
  })

  it('fills default form values for hourly mode', () => {
    const state = inferAutopilotScheduleFormState('0 */1 * * *')

    expect(state.dayOfMonth).toBe(1)
    expect(state.intervalDays).toBe(1)
    expect(state.intervalMinutes).toBe(15)
    expect(state.intervalMonths).toBe(1)
  })

  it('fills default form values for weekly mode', () => {
    const state = inferAutopilotScheduleFormState('0 8 * * 1')

    expect(state.dayOfMonth).toBe(1)
    expect(state.intervalDays).toBe(1)
    expect(state.intervalHours).toBe(1)
    expect(state.intervalMinutes).toBe(15)
    expect(state.intervalMonths).toBe(1)
  })

  it('fills default form values for monthly mode', () => {
    const state = inferAutopilotScheduleFormState('30 14 1 */1 *')

    expect(state.intervalDays).toBe(1)
    expect(state.intervalHours).toBe(1)
    expect(state.intervalMinutes).toBe(15)
    expect(state.weekdays).toEqual([1])
  })

  it('fills default form values for custom mode', () => {
    const state = inferAutopilotScheduleFormState('5 4 * * sun')

    expect(state.dayOfMonth).toBe(1)
    expect(state.hour).toBe(9)
    expect(state.intervalDays).toBe(1)
    expect(state.intervalHours).toBe(1)
    expect(state.intervalMinutes).toBe(15)
    expect(state.intervalMonths).toBe(1)
    expect(state.minute).toBe(0)
    expect(state.weekdays).toEqual([1])
  })
})

describe('buildAutopilotCronExpressionFromFormState', () => {
  it('builds cron expression from minutes form state', () => {
    const state = inferAutopilotScheduleFormState('*/10 * * * *')
    const expression = buildAutopilotCronExpressionFromFormState(state)
    expect(expression).toBe('*/10 * * * *')
  })

  it('builds cron expression from hourly form state', () => {
    const state = inferAutopilotScheduleFormState('30 */4 * * *')
    const expression = buildAutopilotCronExpressionFromFormState(state)
    expect(expression).toBe('30 */4 * * *')
  })

  it('builds cron expression from daily form state', () => {
    const state = inferAutopilotScheduleFormState('0 9 */1 * *')
    const expression = buildAutopilotCronExpressionFromFormState(state)
    expect(expression).toBe('0 9 */1 * *')
  })

  it('builds cron expression from weekly form state', () => {
    const state = inferAutopilotScheduleFormState('0 8 * * 1,3,5')
    const expression = buildAutopilotCronExpressionFromFormState(state)
    expect(expression).toBe('0 8 * * 1,3,5')
  })

  it('builds cron expression from monthly form state', () => {
    const state = inferAutopilotScheduleFormState('0 10 15 */2 *')
    const expression = buildAutopilotCronExpressionFromFormState(state)
    expect(expression).toBe('0 10 15 */2 *')
  })

  it('builds cron expression from custom form state', () => {
    const state: AutopilotScheduleFormState = {
      customCronExpression: '0 9 1-15 * 1-5',
      dayOfMonth: 1,
      hour: 9,
      intervalDays: 1,
      intervalHours: 1,
      intervalMinutes: 15,
      intervalMonths: 1,
      minute: 0,
      mode: 'custom',
      weekdays: [1],
    }
    const expression = buildAutopilotCronExpressionFromFormState(state)
    expect(expression).toBe('0 9 1-15 * 1-5')
  })

  it('round-trips through infer and build for daily mode', () => {
    const original = '15 9 */3 * *'
    const state = inferAutopilotScheduleFormState(original)
    const expression = buildAutopilotCronExpressionFromFormState(state)
    expect(expression).toBe(original)
  })
})

describe('getAutopilotSchedulePreview', () => {
  it('returns a valid preview with upcoming runs', () => {
    const state = inferAutopilotScheduleFormState('0 9 */1 * *')
    const preview = getAutopilotSchedulePreview(state, 'UTC')

    expect(preview.cronExpression).toBe('0 9 */1 * *')
    expect(preview.isValid).toBe(true)
    expect(preview.nextRuns).toHaveLength(3)
    expect(preview.nextRuns[0]).toBeInstanceOf(Date)
  })

  it('returns invalid preview for bad timezone', () => {
    const state = inferAutopilotScheduleFormState('0 9 */1 * *')
    const preview = getAutopilotSchedulePreview(state, 'Mars/Olympus')

    expect(preview.isValid).toBe(false)
    expect(preview.nextRuns).toEqual([])
  })

  it('returns valid preview for weekly schedule', () => {
    const state = inferAutopilotScheduleFormState('0 8 * * 1,3,5')
    const preview = getAutopilotSchedulePreview(state, 'Europe/Madrid')

    expect(preview.isValid).toBe(true)
    expect(preview.nextRuns.length).toBeGreaterThan(0)
  })
})
