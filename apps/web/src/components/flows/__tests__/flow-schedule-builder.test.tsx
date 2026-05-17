/** @vitest-environment jsdom */

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FlowScheduleBuilder } from '@/components/flows/flow-schedule-builder'
import type { FlowScheduleFormState, FlowSchedulePreview } from '@/lib/flows/schedule-form'

const baseSchedule: FlowScheduleFormState = {
  customCronExpression: '',
  dayOfMonth: 1,
  hour: 9,
  intervalDays: 1,
  intervalHours: 1,
  intervalMinutes: 15,
  intervalMonths: 1,
  minute: 0,
  mode: 'minutes',
  weekdays: [1],
}

const validPreview: FlowSchedulePreview = {
  cronExpression: '*/15 * * * *',
  isValid: true,
  nextRuns: [new Date('2026-01-01T09:15:00.000Z')],
}

function ScheduleHarness({
  initialSchedule = baseSchedule,
  preview = validPreview,
}: {
  initialSchedule?: FlowScheduleFormState
  preview?: FlowSchedulePreview
}) {
  const [schedule, setSchedule] = useState(initialSchedule)
  const [timezone, setTimezone] = useState('UTC')

  return (
    <FlowScheduleBuilder
      preview={preview}
      schedule={schedule}
      timezone={timezone}
      timezoneOptions={['UTC', 'America/Los_Angeles', 'Europe/Madrid']}
      onChange={setSchedule}
      onTimezoneChange={setTimezone}
    />
  )
}

describe('FlowScheduleBuilder', () => {
  afterEach(() => cleanup())

  it('switches schedule modes and updates visible fields', () => {
    render(<ScheduleHarness />)

    const frequency = screen.getByLabelText('Schedule frequency') as HTMLSelectElement

    fireEvent.change(screen.getByLabelText('Every N minutes'), { target: { value: '30' } })
    expect((screen.getByLabelText('Every N minutes') as HTMLInputElement).value).toBe('30')

    fireEvent.change(frequency, { target: { value: 'hourly' } })
    fireEvent.change(screen.getByLabelText('Minute of the hour'), { target: { value: '20' } })
    expect((screen.getByLabelText('Minute of the hour') as HTMLInputElement).value).toBe('20')

    fireEvent.change(frequency, { target: { value: 'daily' } })
    expect(screen.getByLabelText('Every N days')).toBeTruthy()

    fireEvent.change(frequency, { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }))
    expect(screen.getByRole('group', { name: 'Weekdays' })).toBeTruthy()

    fireEvent.change(frequency, { target: { value: 'monthly' } })
    expect(screen.getByLabelText('Day of month')).toBeTruthy()

    fireEvent.change(frequency, { target: { value: 'custom' } })
    const customCronInput = screen.getByLabelText('Custom cron expression') as HTMLInputElement
    fireEvent.change(customCronInput, { target: { value: '0 9 * * 1-5' } })
    expect(customCronInput.value).toBe('0 9 * * 1-5')
    expect(screen.getByText(/Next \d run/)).toBeTruthy()
  })

  it('shows invalid preview feedback when no upcoming runs exist', () => {
    render(
      <ScheduleHarness
        preview={{
          cronExpression: '* * *',
          isValid: false,
          nextRuns: [],
        }}
      />,
    )

    expect(screen.getByText('The cron expression or timezone is invalid.')).toBeTruthy()
  })

  for (const scenario of [
    { labels: ['Minute of the hour'], mode: 'hourly' as const },
    { labels: ['Hour', 'Minute'], mode: 'daily' as const },
    { labels: ['Hour', 'Minute'], mode: 'weekly' as const },
    { labels: ['Hour', 'Minute'], mode: 'monthly' as const },
  ]) {
    it(`allows deleting and typing raw ${scenario.mode} time values before padding on blur`, () => {
      render(<ScheduleHarness initialSchedule={{ ...baseSchedule, hour: 0, minute: 0, mode: scenario.mode }} />)

      for (const label of scenario.labels) {
        const input = screen.getByLabelText(label) as HTMLInputElement

        expect(input.value).toBe('00')
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: '' } })
        expect(input.value).toBe('')
        fireEvent.change(input, { target: { value: '7' } })
        expect(input.value).toBe('7')
        fireEvent.blur(input)
        expect(input.value).toBe('07')
      }
    })
  }

  it('normalizes numeric schedule inputs on blur without blocking raw typing', () => {
    render(<ScheduleHarness initialSchedule={{ ...baseSchedule, dayOfMonth: 1, intervalMonths: 1, mode: 'monthly' }} />)

    const dayOfMonthInput = screen.getByLabelText('Day of month') as HTMLInputElement
    fireEvent.change(dayOfMonthInput, { target: { value: '99' } })
    expect(dayOfMonthInput.value).toBe('99')
    fireEvent.blur(dayOfMonthInput)
    expect(dayOfMonthInput.value).toBe('31')

    const intervalMonthsInput = screen.getByLabelText('Every N months') as HTMLInputElement
    fireEvent.change(intervalMonthsInput, { target: { value: '0' } })
    expect(intervalMonthsInput.value).toBe('0')
    fireEvent.blur(intervalMonthsInput)
    expect(intervalMonthsInput.value).toBe('1')
  })
})
