'use client'

import type { ComponentType, Dispatch, SetStateAction } from 'react'
import { useCallback } from 'react'
import {
  Calendar,
  CalendarBlank,
  Code,
  Clock,
  Sun,
  Timer,
  type IconProps,
} from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatAutopilotRunDate } from '@/lib/autopilot/cron'
import {
  AUTOPILOT_WEEKDAY_OPTIONS,
  buildAutopilotCronExpressionFromFormState,
  type AutopilotScheduleFormState,
  type AutopilotSchedulePreview,
} from '@/lib/autopilot/schedule-form'
import type { AutopilotScheduleBuilderMode } from '@/lib/autopilot/types'
import { cn } from '@/lib/utils'

type AutopilotScheduleBuilderProps = {
  preview: AutopilotSchedulePreview
  schedule: AutopilotScheduleFormState
  timezone: string
  onChange: Dispatch<SetStateAction<AutopilotScheduleFormState>>
}

type ScheduleOption = {
  mode: AutopilotScheduleBuilderMode
  label: string
  hint: string
  icon: ComponentType<IconProps>
}

const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { mode: 'minutes', label: 'Minutes', hint: 'Every N minutes', icon: Timer },
  { mode: 'hourly', label: 'Hourly', hint: 'Every N hours', icon: Clock },
  { mode: 'daily', label: 'Daily', hint: 'Every N days at HH:MM', icon: Sun },
  { mode: 'weekly', label: 'Weekly', hint: 'On selected weekdays', icon: CalendarBlank },
  { mode: 'monthly', label: 'Monthly', hint: 'On day of month', icon: Calendar },
  { mode: 'custom', label: 'Custom', hint: 'Raw cron expression', icon: Code },
]

export function AutopilotScheduleBuilder({
  preview,
  schedule,
  timezone,
  onChange,
}: AutopilotScheduleBuilderProps) {
  const updateSchedule = useCallback(
    (updater: (current: AutopilotScheduleFormState) => AutopilotScheduleFormState) => {
      onChange((current) => updater(current))
    },
    [onChange],
  )

  const setScheduleMode = useCallback((nextMode: AutopilotScheduleBuilderMode) => {
    updateSchedule((current) => ({
      ...current,
      customCronExpression:
        nextMode === 'custom'
          ? buildAutopilotCronExpressionFromFormState(current)
          : current.customCronExpression,
      mode: nextMode,
    }))
  }, [updateSchedule])

  const activeOption = SCHEDULE_OPTIONS.find((option) => option.mode === schedule.mode)

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="space-y-5">
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <Label>Schedule</Label>
            {activeOption ? (
              <span className="text-xs text-muted-foreground">{activeOption.hint}</span>
            ) : null}
          </div>
          <div
            role="tablist"
            aria-label="Schedule frequency"
            className="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-background/40 p-1.5 sm:grid-cols-6"
          >
            {SCHEDULE_OPTIONS.map(({ mode, label, icon: Icon }) => {
              const active = schedule.mode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScheduleMode(mode)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all',
                    active
                      ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  <Icon size={13} weight={active ? 'fill' : 'regular'} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {schedule.mode === 'minutes' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="interval-minutes">Every N minutes</Label>
              <Input
                id="interval-minutes"
                type="number"
                min={1}
                value={schedule.intervalMinutes}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  intervalMinutes: Number.parseInt(event.target.value, 10) || 1,
                }))}
              />
            </div>
          </div>
        ) : null}

        {schedule.mode === 'hourly' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="interval-hours">Every N hours</Label>
              <Input
                id="interval-hours"
                type="number"
                min={1}
                value={schedule.intervalHours}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  intervalHours: Number.parseInt(event.target.value, 10) || 1,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hourly-minute">Minute of the hour</Label>
              <Input
                id="hourly-minute"
                type="number"
                min={0}
                max={59}
                value={schedule.minute}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  minute: Number.parseInt(event.target.value, 10) || 0,
                }))}
              />
            </div>
          </div>
        ) : null}

        {schedule.mode === 'daily' ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="interval-days">Every N days</Label>
              <Input
                id="interval-days"
                type="number"
                min={1}
                value={schedule.intervalDays}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  intervalDays: Number.parseInt(event.target.value, 10) || 1,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-hour">Hour</Label>
              <Input
                id="daily-hour"
                type="number"
                min={0}
                max={23}
                value={schedule.hour}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  hour: Number.parseInt(event.target.value, 10) || 0,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-minute">Minute</Label>
              <Input
                id="daily-minute"
                type="number"
                min={0}
                max={59}
                value={schedule.minute}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  minute: Number.parseInt(event.target.value, 10) || 0,
                }))}
              />
            </div>
          </div>
        ) : null}

        {schedule.mode === 'weekly' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Weekdays</Label>
              <div className="flex flex-wrap gap-2">
                {AUTOPILOT_WEEKDAY_OPTIONS.map((option) => {
                  const selected = schedule.weekdays.includes(option.value)

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateSchedule((current) => ({
                        ...current,
                        weekdays: selected
                          ? current.weekdays.filter((weekday) => weekday !== option.value)
                          : [...current.weekdays, option.value].sort((left, right) => left - right),
                      }))}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm transition-colors',
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="weekly-hour">Hour</Label>
                <Input
                  id="weekly-hour"
                  type="number"
                  min={0}
                  max={23}
                  value={schedule.hour}
                  onChange={(event) => updateSchedule((current) => ({
                    ...current,
                    hour: Number.parseInt(event.target.value, 10) || 0,
                  }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weekly-minute">Minute</Label>
                <Input
                  id="weekly-minute"
                  type="number"
                  min={0}
                  max={59}
                  value={schedule.minute}
                  onChange={(event) => updateSchedule((current) => ({
                    ...current,
                    minute: Number.parseInt(event.target.value, 10) || 0,
                  }))}
                />
              </div>
            </div>
          </div>
        ) : null}

        {schedule.mode === 'monthly' ? (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="interval-months">Every N months</Label>
              <Input
                id="interval-months"
                type="number"
                min={1}
                value={schedule.intervalMonths}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  intervalMonths: Number.parseInt(event.target.value, 10) || 1,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthly-day">Day of month</Label>
              <Input
                id="monthly-day"
                type="number"
                min={1}
                max={31}
                value={schedule.dayOfMonth}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  dayOfMonth: Number.parseInt(event.target.value, 10) || 1,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthly-hour">Hour</Label>
              <Input
                id="monthly-hour"
                type="number"
                min={0}
                max={23}
                value={schedule.hour}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  hour: Number.parseInt(event.target.value, 10) || 0,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthly-minute">Minute</Label>
              <Input
                id="monthly-minute"
                type="number"
                min={0}
                max={59}
                value={schedule.minute}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  minute: Number.parseInt(event.target.value, 10) || 0,
                }))}
              />
            </div>
          </div>
        ) : null}

        {schedule.mode === 'custom' ? (
          <div className="space-y-2">
            <Label htmlFor="custom-cron">Custom cron expression</Label>
            <Input
              id="custom-cron"
              value={schedule.customCronExpression}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                customCronExpression: event.target.value,
              }))}
              placeholder="0 9 * * 1-5"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Use standard 5-field cron format: minute hour day-of-month month day-of-week.
            </p>
          </div>
        ) : null}

        <div className="border-t border-border/40 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">Resolved cron</p>
            <code className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1 font-mono text-xs text-foreground">
              {preview.cronExpression}
            </code>
          </div>
          {preview.isValid && preview.nextRuns.length > 0 ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-muted-foreground">Upcoming runs ({timezone})</p>
              <div className="flex flex-wrap gap-1.5">
                {preview.nextRuns.map((runAt) => (
                  <Badge key={runAt.toISOString()} variant="outline" className="font-normal">
                    {formatAutopilotRunDate(runAt, timezone)}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-destructive">
              The cron expression or timezone is invalid.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
