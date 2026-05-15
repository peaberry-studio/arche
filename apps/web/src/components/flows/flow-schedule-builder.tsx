'use client'

import { useCallback, type ComponentType, type Dispatch, type SetStateAction } from 'react'
import {
  Calendar,
  CalendarBlank,
  Code,
  Clock,
  Sun,
  Timer,
  type IconProps,
} from '@phosphor-icons/react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatFlowRunDate } from '@/lib/flows/cron'
import {
  FLOW_WEEKDAY_OPTIONS,
  buildFlowCronExpressionFromFormState,
  type FlowScheduleBuilderMode,
  type FlowScheduleFormState,
  type FlowSchedulePreview,
} from '@/lib/flows/schedule-form'
import { cn } from '@/lib/utils'

type FlowScheduleBuilderProps = {
  preview: FlowSchedulePreview
  schedule: FlowScheduleFormState
  timezone: string
  onChange: Dispatch<SetStateAction<FlowScheduleFormState>>
}

type ScheduleOption = {
  mode: FlowScheduleBuilderMode
  label: string
  icon: ComponentType<IconProps>
}

const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { mode: 'minutes', label: 'Minutes', icon: Timer },
  { mode: 'hourly', label: 'Hourly', icon: Clock },
  { mode: 'daily', label: 'Daily', icon: Sun },
  { mode: 'weekly', label: 'Weekly', icon: CalendarBlank },
  { mode: 'monthly', label: 'Monthly', icon: Calendar },
  { mode: 'custom', label: 'Custom', icon: Code },
]

const numberInputClass = 'h-9 w-16 text-center font-medium tabular-nums'
const timeInputClass = 'h-9 w-14 text-center font-medium tabular-nums'

export function FlowScheduleBuilder({
  preview,
  schedule,
  timezone,
  onChange,
}: FlowScheduleBuilderProps) {
  const updateSchedule = useCallback(
    (updater: (current: FlowScheduleFormState) => FlowScheduleFormState) => {
      onChange((current) => updater(current))
    },
    [onChange],
  )

  const setScheduleMode = useCallback((nextMode: FlowScheduleBuilderMode) => {
    updateSchedule((current) => ({
      ...current,
      customCronExpression:
        nextMode === 'custom'
          ? buildFlowCronExpressionFromFormState(current)
          : current.customCronExpression,
      mode: nextMode,
    }))
  }, [updateSchedule])

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Schedule frequency"
        className="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-background/50 p-1 sm:grid-cols-6"
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
                  ? 'bg-card text-primary shadow-sm ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
            >
              <Icon size={13} weight={active ? 'fill' : 'regular'} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border border-border/50 bg-background/40 px-4 py-3.5">
        {schedule.mode === 'minutes' ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm text-foreground">
            <span>Run every</span>
            <Input
              id="flow-interval-minutes"
              aria-label="Every N minutes"
              type="number"
              min={1}
              value={schedule.intervalMinutes}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                intervalMinutes: Number.parseInt(event.target.value, 10) || 1,
              }))}
              className={numberInputClass}
            />
            <span className="text-muted-foreground">minute(s).</span>
          </div>
        ) : null}

        {schedule.mode === 'hourly' ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm text-foreground">
            <span>Run every</span>
            <Input
              id="flow-interval-hours"
              aria-label="Every N hours"
              type="number"
              min={1}
              value={schedule.intervalHours}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                intervalHours: Number.parseInt(event.target.value, 10) || 1,
              }))}
              className={numberInputClass}
            />
            <span className="text-muted-foreground">hour(s) at minute</span>
            <Input
              id="flow-hourly-minute"
              aria-label="Minute of the hour"
              type="number"
              min={0}
              max={59}
              value={schedule.minute}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                minute: Number.parseInt(event.target.value, 10) || 0,
              }))}
              className={timeInputClass}
            />
            <span className="text-muted-foreground">.</span>
          </div>
        ) : null}

        {schedule.mode === 'daily' ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm text-foreground">
            <span>Run every</span>
            <Input
              id="flow-interval-days"
              aria-label="Every N days"
              type="number"
              min={1}
              value={schedule.intervalDays}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                intervalDays: Number.parseInt(event.target.value, 10) || 1,
              }))}
              className={numberInputClass}
            />
            <span className="text-muted-foreground">day(s) at</span>
            <Input
              id="flow-daily-hour"
              aria-label="Hour"
              type="number"
              min={0}
              max={23}
              value={schedule.hour}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                hour: Number.parseInt(event.target.value, 10) || 0,
              }))}
              className={timeInputClass}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              id="flow-daily-minute"
              aria-label="Minute"
              type="number"
              min={0}
              max={59}
              value={schedule.minute}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                minute: Number.parseInt(event.target.value, 10) || 0,
              }))}
              className={timeInputClass}
            />
          </div>
        ) : null}

        {schedule.mode === 'weekly' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Weekdays
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {FLOW_WEEKDAY_OPTIONS.map((option) => {
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
                        'h-8 w-12 rounded-md border text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border/70 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm text-foreground">
              <span className="text-muted-foreground">at</span>
              <Input
                id="flow-weekly-hour"
                aria-label="Hour"
                type="number"
                min={0}
                max={23}
                value={schedule.hour}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  hour: Number.parseInt(event.target.value, 10) || 0,
                }))}
                className={timeInputClass}
              />
              <span className="text-muted-foreground">:</span>
              <Input
                id="flow-weekly-minute"
                aria-label="Minute"
                type="number"
                min={0}
                max={59}
                value={schedule.minute}
                onChange={(event) => updateSchedule((current) => ({
                  ...current,
                  minute: Number.parseInt(event.target.value, 10) || 0,
                }))}
                className={timeInputClass}
              />
            </div>
          </div>
        ) : null}

        {schedule.mode === 'monthly' ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm text-foreground">
            <span>Run every</span>
            <Input
              id="flow-interval-months"
              aria-label="Every N months"
              type="number"
              min={1}
              value={schedule.intervalMonths}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                intervalMonths: Number.parseInt(event.target.value, 10) || 1,
              }))}
              className={numberInputClass}
            />
            <span className="text-muted-foreground">month(s) on day</span>
            <Input
              id="flow-monthly-day"
              aria-label="Day of month"
              type="number"
              min={1}
              max={31}
              value={schedule.dayOfMonth}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                dayOfMonth: Number.parseInt(event.target.value, 10) || 1,
              }))}
              className={numberInputClass}
            />
            <span className="text-muted-foreground">at</span>
            <Input
              id="flow-monthly-hour"
              aria-label="Hour"
              type="number"
              min={0}
              max={23}
              value={schedule.hour}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                hour: Number.parseInt(event.target.value, 10) || 0,
              }))}
              className={timeInputClass}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              id="flow-monthly-minute"
              aria-label="Minute"
              type="number"
              min={0}
              max={59}
              value={schedule.minute}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                minute: Number.parseInt(event.target.value, 10) || 0,
              }))}
              className={timeInputClass}
            />
          </div>
        ) : null}

        {schedule.mode === 'custom' ? (
          <div className="space-y-2">
            <Label htmlFor="flow-custom-cron" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Custom cron expression
            </Label>
            <Input
              id="flow-custom-cron"
              value={schedule.customCronExpression}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                customCronExpression: event.target.value,
              }))}
              placeholder="0 9 * * 1-5"
              className="h-9 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Standard 5-field cron: minute hour day-of-month month day-of-week.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-3.5 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Resolved cron
        </span>
        <code className="font-mono text-xs text-foreground">{preview.cronExpression}</code>
      </div>

      {preview.isValid && preview.nextRuns.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Upcoming runs ({timezone})
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {preview.nextRuns.map((runAt) => (
              <li
                key={runAt.toISOString()}
                className="flex items-center gap-2.5 rounded-md border border-border/40 bg-background/30 px-3 py-1.5 text-sm text-foreground"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
                <span className="tabular-nums">{formatFlowRunDate(runAt, timezone)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-destructive">The cron expression or timezone is invalid.</p>
      )}
    </div>
  )
}
