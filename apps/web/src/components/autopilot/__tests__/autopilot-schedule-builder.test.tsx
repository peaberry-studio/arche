/** @vitest-environment jsdom */

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AutopilotScheduleBuilder } from '@/components/autopilot/autopilot-schedule-builder'
import type {
  AutopilotScheduleFormState,
  AutopilotSchedulePreview,
} from '@/lib/autopilot/schedule-form'

const baseSchedule: AutopilotScheduleFormState = {
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

const validPreview: AutopilotSchedulePreview = {
  cronExpression: '*/15 * * * *',
  isValid: true,
  nextRuns: [new Date('2026-01-01T09:15:00.000Z')],
}

function ScheduleHarness({
  initialSchedule = baseSchedule,
  preview = validPreview,
}: {
  initialSchedule?: AutopilotScheduleFormState
  preview?: AutopilotSchedulePreview
}) {
  const [schedule, setSchedule] = useState(initialSchedule)

  return (
    <AutopilotScheduleBuilder
      preview={preview}
      schedule={schedule}
      timezone="UTC"
      onChange={setSchedule}
    />
  )
}

describe('AutopilotScheduleBuilder', () => {
  afterEach(() => {
    cleanup()
  })

  it('switches schedule modes and updates visible fields', () => {
    render(<ScheduleHarness />)

    const minutesInput = screen.getByLabelText('Every N minutes') as HTMLInputElement
    fireEvent.change(minutesInput, { target: { value: '30' } })
    expect(minutesInput.value).toBe('30')

    fireEvent.click(screen.getByRole('tab', { name: 'Hourly' }))
    expect(screen.getByLabelText('Every N hours')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Minute of the hour'), { target: { value: '20' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Daily' }))
    expect(screen.getByLabelText('Every N days')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '11' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }))
    expect(screen.getByText('Weekdays')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }))
    expect(screen.getByLabelText('Day of month')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Every N months'), { target: { value: '2' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }))
    const customCronInput = screen.getByLabelText('Custom cron expression') as HTMLInputElement
    fireEvent.change(customCronInput, { target: { value: '0 9 * * 1-5' } })
    expect(customCronInput.value).toBe('0 9 * * 1-5')
    expect(screen.getByText('*/15 * * * *')).toBeTruthy()
    expect(screen.getByText(/Upcoming runs/)).toBeTruthy()
  })

  it('updates every schedule field for mode-specific forms', () => {
    render(<ScheduleHarness />)

    fireEvent.click(screen.getByRole('tab', { name: 'Hourly' }))
    fireEvent.change(screen.getByLabelText('Every N hours'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Minute of the hour'), { target: { value: '5' } })
    expect((screen.getByLabelText('Every N hours') as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText('Minute of the hour') as HTMLInputElement).value).toBe('5')

    fireEvent.click(screen.getByRole('tab', { name: 'Daily' }))
    fireEvent.change(screen.getByLabelText('Every N days'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '30' } })
    expect((screen.getByLabelText('Every N days') as HTMLInputElement).value).toBe('2')
    expect((screen.getByLabelText('Hour') as HTMLInputElement).value).toBe('6')
    expect((screen.getByLabelText('Minute') as HTMLInputElement).value).toBe('30')

    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '45' } })
    expect((screen.getByLabelText('Hour') as HTMLInputElement).value).toBe('7')
    expect((screen.getByLabelText('Minute') as HTMLInputElement).value).toBe('45')

    fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }))
    fireEvent.change(screen.getByLabelText('Every N months'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '15' } })

    expect((screen.getByLabelText('Every N months') as HTMLInputElement).value).toBe('4')
    expect((screen.getByLabelText('Day of month') as HTMLInputElement).value).toBe('12')
    expect((screen.getByLabelText('Hour') as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText('Minute') as HTMLInputElement).value).toBe('15')
  })

  it('shows invalid preview feedback when no upcoming runs exist', () => {
    render(
      <ScheduleHarness
        preview={{
          cronExpression: '* * *',
          isValid: false,
          nextRuns: [],
        }}
      />
    )

    expect(screen.getByText('The cron expression or timezone is invalid.')).toBeTruthy()
  })
})
