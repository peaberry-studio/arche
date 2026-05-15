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

  return (
    <FlowScheduleBuilder
      preview={preview}
      schedule={schedule}
      timezone="UTC"
      onChange={setSchedule}
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
    expect(screen.getByText('*/15 * * * *')).toBeTruthy()
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
})
