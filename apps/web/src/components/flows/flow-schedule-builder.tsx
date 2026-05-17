'use client'

import { useCallback, type ComponentType, type Dispatch, type SetStateAction } from 'react'
import {
  Calendar,
  CalendarBlank,
  CaretDown,
  Code,
  Clock,
  Sun,
  Timer,
  type IconProps,
} from '@phosphor-icons/react'

import { Input } from '@/components/ui/input'
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
  timezoneOptions: string[]
  onChange: Dispatch<SetStateAction<FlowScheduleFormState>>
  onTimezoneChange: (timezone: string) => void
}

type ScheduleOption = {
  mode: FlowScheduleBuilderMode
  label: string
  icon: ComponentType<IconProps>
}

const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { mode: 'minutes', label: 'Every X minutes', icon: Timer },
  { mode: 'hourly', label: 'Hourly', icon: Clock },
  { mode: 'daily', label: 'Daily', icon: Sun },
  { mode: 'weekly', label: 'Weekly', icon: CalendarBlank },
  { mode: 'monthly', label: 'Monthly', icon: Calendar },
  { mode: 'custom', label: 'Custom cron', icon: Code },
]

const SCHEDULE_MODES: FlowScheduleBuilderMode[] = SCHEDULE_OPTIONS.map((option) => option.mode)

const hideSpinners =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
const numberInputClass = cn('h-9 w-16 text-center font-medium tabular-nums focus-visible:ring-offset-0', hideSpinners)
const timeInputClass = cn('h-9 w-14 text-center font-medium tabular-nums focus-visible:ring-offset-0', hideSpinners)

function parseTimeDigits(raw: string, max: number): number {
  const digits = raw.replace(/\D/g, '').slice(-2)
  if (!digits) return 0
  const value = Number.parseInt(digits, 10)
  if (Number.isNaN(value)) return 0
  return Math.min(value, max)
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0')
}

function formatRelativeRunTime(date: Date, now: Date): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const diffMs = date.getTime() - now.getTime()
  const absMs = Math.abs(diffMs)

  if (absMs < 60_000) return rtf.format(Math.round(diffMs / 1_000), 'second')
  if (absMs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute')
  if (absMs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour')
  if (absMs < 14 * 86_400_000) return rtf.format(Math.round(diffMs / 86_400_000), 'day')
  if (absMs < 60 * 86_400_000) return rtf.format(Math.round(diffMs / (86_400_000 * 7)), 'week')
  return rtf.format(Math.round(diffMs / (86_400_000 * 30)), 'month')
}

export function FlowScheduleBuilder({
  preview,
  schedule,
  timezone,
  timezoneOptions,
  onChange,
  onTimezoneChange,
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

  const activeOption = SCHEDULE_OPTIONS.find((option) => option.mode === schedule.mode) ?? SCHEDULE_OPTIONS[0]
  const ActiveIcon = activeOption.icon

  const now = new Date()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-3 text-sm text-foreground">
        <span className="text-muted-foreground">Run</span>

        <div className="relative inline-flex h-9 items-center gap-2 rounded-md border border-border/70 bg-background/60 pl-3 pr-8 text-sm font-medium transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 hover:border-border">
          <ActiveIcon size={14} weight="fill" className="text-primary" />
          <span className="pointer-events-none">{activeOption.label}</span>
          <CaretDown size={12} className="pointer-events-none absolute right-2.5 text-muted-foreground" />
          <select
            aria-label="Schedule frequency"
            value={schedule.mode}
            onChange={(event) => {
              const next = event.target.value as FlowScheduleBuilderMode
              if (SCHEDULE_MODES.includes(next)) setScheduleMode(next)
            }}
            className="absolute inset-0 cursor-pointer appearance-none bg-transparent text-transparent opacity-0 focus:outline-none"
          >
            {SCHEDULE_OPTIONS.map((option) => (
              <option key={option.mode} value={option.mode} className="bg-background text-foreground">
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {schedule.mode === 'minutes' ? (
          <>
            <span className="text-muted-foreground">every</span>
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
            <span className="text-muted-foreground">minute(s)</span>
          </>
        ) : null}

        {schedule.mode === 'hourly' ? (
          <>
            <span className="text-muted-foreground">every</span>
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
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={padTwo(schedule.minute)}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                minute: parseTimeDigits(event.target.value, 59),
              }))}
              className={timeInputClass}
            />
          </>
        ) : null}

        {schedule.mode === 'daily' ? (
          <>
            <span className="text-muted-foreground">every</span>
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
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={padTwo(schedule.hour)}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                hour: parseTimeDigits(event.target.value, 23),
              }))}
              className={timeInputClass}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              id="flow-daily-minute"
              aria-label="Minute"
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={padTwo(schedule.minute)}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                minute: parseTimeDigits(event.target.value, 59),
              }))}
              className={timeInputClass}
            />
          </>
        ) : null}

        {schedule.mode === 'weekly' ? (
          <>
            <span className="text-muted-foreground">at</span>
            <Input
              id="flow-weekly-hour"
              aria-label="Hour"
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={padTwo(schedule.hour)}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                hour: parseTimeDigits(event.target.value, 23),
              }))}
              className={timeInputClass}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              id="flow-weekly-minute"
              aria-label="Minute"
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={padTwo(schedule.minute)}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                minute: parseTimeDigits(event.target.value, 59),
              }))}
              className={timeInputClass}
            />
            <div className="basis-full" />
            <span className="text-muted-foreground">on</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
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
                      'h-8 w-10 rounded-md border text-xs font-medium transition-colors',
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
          </>
        ) : null}

        {schedule.mode === 'monthly' ? (
          <>
            <span className="text-muted-foreground">every</span>
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
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={padTwo(schedule.hour)}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                hour: parseTimeDigits(event.target.value, 23),
              }))}
              className={timeInputClass}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              id="flow-monthly-minute"
              aria-label="Minute"
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={padTwo(schedule.minute)}
              onChange={(event) => updateSchedule((current) => ({
                ...current,
                minute: parseTimeDigits(event.target.value, 59),
              }))}
              className={timeInputClass}
            />
          </>
        ) : null}

        {schedule.mode === 'custom' ? (
          <Input
            id="flow-custom-cron"
            aria-label="Custom cron expression"
            value={schedule.customCronExpression}
            onChange={(event) => updateSchedule((current) => ({
              ...current,
              customCronExpression: event.target.value,
            }))}
            placeholder="0 9 * * 1-5"
            className="h-9 w-56 font-mono"
          />
        ) : null}

        <span className="text-muted-foreground">in</span>
        <div className="relative inline-flex h-9 items-center gap-2 rounded-md border border-border/70 bg-background/60 pl-3 pr-8 text-sm font-medium transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 hover:border-border">
          <span className="pointer-events-none max-w-[16rem] truncate">{timezone}</span>
          <CaretDown size={12} className="pointer-events-none absolute right-2.5 text-muted-foreground" />
          <select
            aria-label="Timezone"
            value={timezone}
            onChange={(event) => onTimezoneChange(event.target.value)}
            className="absolute inset-0 cursor-pointer appearance-none bg-transparent text-transparent opacity-0 focus:outline-none"
          >
            {timezoneOptions.includes(timezone) ? null : (
              <option value={timezone} className="bg-background text-foreground">{timezone}</option>
            )}
            {timezoneOptions.map((option) => (
              <option key={option} value={option} className="bg-background text-foreground">
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {preview.isValid && preview.nextRuns.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Next {preview.nextRuns.length} run{preview.nextRuns.length === 1 ? '' : 's'}
          </p>
          <ul className="flex flex-wrap gap-2">
            {preview.nextRuns.map((runAt) => (
              <li
                key={runAt.toISOString()}
                className="inline-flex flex-col gap-1 rounded-md border border-border/60 bg-background/60 px-3 py-2.5 tabular-nums leading-none"
              >
                <span className="text-xs font-medium text-foreground">{formatFlowRunDate(runAt, timezone)}</span>
                <span className="text-[11px] text-muted-foreground">{formatRelativeRunTime(runAt, now)}</span>
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
