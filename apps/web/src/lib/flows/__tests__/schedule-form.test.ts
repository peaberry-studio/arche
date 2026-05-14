import { describe, expect, it } from 'vitest'

import {
  buildFlowCronExpressionFromFormState,
  getDefaultFlowScheduleFormState,
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
})
