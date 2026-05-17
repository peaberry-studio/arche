import { describe, expect, it } from 'vitest'

import {
  buildFlowCronExpressionFromBuilder,
  buildFlowCronExpressionFromFormState,
  getDefaultFlowScheduleFormState,
  getFlowSchedulePreview,
  inferFlowScheduleBuilderState,
  inferFlowScheduleFormState,
} from '@/lib/flows/schedule-form'

describe('flow schedule form helpers', () => {
  it('defaults to a daily schedule', () => {
    expect(buildFlowCronExpressionFromFormState(getDefaultFlowScheduleFormState())).toBe('0 9 */1 * *')
  })

  it('infers guided schedule modes from cron expressions', () => {
    expect(inferFlowScheduleFormState('*/15 * * * *')).toEqual(expect.objectContaining({ intervalMinutes: 15, mode: 'minutes' }))
    expect(inferFlowScheduleFormState('5 */3 * * *')).toEqual(expect.objectContaining({ intervalHours: 3, minute: 5, mode: 'hourly' }))
    expect(inferFlowScheduleFormState('30 6 */2 * *')).toEqual(expect.objectContaining({ hour: 6, intervalDays: 2, minute: 30, mode: 'daily' }))
    expect(inferFlowScheduleFormState('45 7 * * 1,3')).toEqual(expect.objectContaining({ hour: 7, minute: 45, mode: 'weekly', weekdays: [1, 3] }))
    expect(inferFlowScheduleFormState('15 8 12 */4 *')).toEqual(expect.objectContaining({ dayOfMonth: 12, hour: 8, intervalMonths: 4, minute: 15, mode: 'monthly' }))
  })

  it('keeps unsupported cron expressions in custom mode', () => {
    expect(inferFlowScheduleFormState('0 9 1 * 1')).toEqual(expect.objectContaining({ customCronExpression: '0 9 1 * 1', mode: 'custom' }))
  })

  it('normalizes guided schedule builder values into cron expressions', () => {
    expect(buildFlowCronExpressionFromBuilder({ intervalMinutes: 1, mode: 'minutes' })).toBe('* * * * *')
    expect(buildFlowCronExpressionFromBuilder({ intervalMinutes: 0, mode: 'minutes' })).toBe('*/15 * * * *')
    expect(buildFlowCronExpressionFromBuilder({ intervalHours: 2.7, minute: 61, mode: 'hourly' })).toBe('59 */2 * * *')
    expect(buildFlowCronExpressionFromBuilder({ hour: -1, intervalDays: 0, minute: Number.NaN, mode: 'daily' })).toBe('0 0 */1 * *')
    expect(buildFlowCronExpressionFromBuilder({ hour: 25, minute: 7.8, mode: 'weekly', weekdays: [5, 1, 5, 9] })).toBe('7 23 * * 1,5,6')
    expect(buildFlowCronExpressionFromBuilder({ dayOfMonth: 40, hour: 4, intervalMonths: 0, minute: 5, mode: 'monthly' })).toBe('5 4 31 */1 *')
    expect(buildFlowCronExpressionFromBuilder({ cronExpression: '  0   8  *  *  1  ', mode: 'custom' })).toBe('0 8 * * 1')
  })

  it('falls back to custom schedule inference for unsupported token shapes', () => {
    expect(inferFlowScheduleBuilderState('0 9')).toEqual({ cronExpression: '0 9', mode: 'custom' })
    expect(inferFlowScheduleBuilderState('x */2 * * *')).toEqual({ cronExpression: 'x */2 * * *', mode: 'custom' })
    expect(inferFlowScheduleBuilderState('0 9 * * 1,x')).toEqual({ cronExpression: '0 9 * * 1,x', mode: 'custom' })
    expect(inferFlowScheduleBuilderState('0 9 1 */x *')).toEqual({ cronExpression: '0 9 1 */x *', mode: 'custom' })
  })

  it('marks invalid schedule previews without throwing', () => {
    const preview = getFlowSchedulePreview({ ...getDefaultFlowScheduleFormState(), customCronExpression: 'not cron', mode: 'custom' }, 'UTC')

    expect(preview).toEqual({ cronExpression: 'not cron', isValid: false, nextRuns: [] })
  })
})
