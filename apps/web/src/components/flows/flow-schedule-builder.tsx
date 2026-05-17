'use client'

import { useCallback, useState, type ComponentType, type Dispatch, type SetStateAction } from 'react'
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

function normalizeIntegerInput(raw: string, min: number, max: number | undefined, fallback: number): number {
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value)) return fallback

  const floored = Math.floor(value)
  const minBounded = Math.max(floored, min)
  return typeof max === 'number' ? Math.min(minBounded, max) : minBounded
}

function parseTimeDigits(raw: string, max: number): number {
  const draft = formatTimeDraft(raw, max)
  if (!draft) return 0
  const value = Number.parseInt(draft, 10)
  if (Number.isNaN(value)) return 0
  return value
}

function formatTimeDraft(raw: string, max: number): string {
  const digits = raw.replace(/\D/g, '').slice(-2)
  if (!digits) return ''
  const value = Number.parseInt(digits, 10)
  if (Number.isNaN(value)) return ''
  return String(Math.min(value, max))
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0')
}

function NumberInput({
  ariaLabel,
  id,
  max,
  min,
  onValueChange,
  value,
}: {
  ariaLabel: string
  id: string
  max?: number
  min: number
  onValueChange: (value: number) => void
  value: number
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const updateValue = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    setDraft(digits)
    onValueChange(normalizeIntegerInput(digits, min, max, min))
  }

  const commitValue = () => {
    const normalized = normalizeIntegerInput(draft ?? String(value), min, max, min)
    onValueChange(normalized)
    setDraft(null)
  }

  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(event) => updateValue(event.target.value)}
      onBlur={commitValue}
      className={numberInputClass}
    />
  )
}

function TimeInput({
  ariaLabel,
  id,
  max,
  onValueChange,
  value,
}: {
  ariaLabel: string
  id: string
  max: number
  onValueChange: (value: number) => void
  value: number
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const updateValue = (raw: string) => {
    const nextDraft = formatTimeDraft(raw, max)
    setDraft(nextDraft)
    onValueChange(parseTimeDigits(nextDraft, max))
  }

  const commitValue = () => {
    const nextValue = parseTimeDigits(draft, max)
    onValueChange(nextValue)
    setDraft(padTwo(nextValue))
    setIsEditing(false)
  }

  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      value={isEditing ? draft : padTwo(value)}
      onFocus={(event) => {
        setIsEditing(true)
        setDraft(padTwo(value))
        event.currentTarget.select()
      }}
      onChange={(event) => updateValue(event.target.value)}
      onBlur={commitValue}
      className={timeInputClass}
    />
  )
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
            <NumberInput
              id="flow-interval-minutes"
              ariaLabel="Every N minutes"
              min={1}
              value={schedule.intervalMinutes}
              onValueChange={(intervalMinutes) => updateSchedule((current) => ({
                ...current,
                intervalMinutes,
              }))}
            />
            <span className="text-muted-foreground">minute(s)</span>
          </>
        ) : null}

        {schedule.mode === 'hourly' ? (
          <>
            <span className="text-muted-foreground">every</span>
            <NumberInput
              id="flow-interval-hours"
              ariaLabel="Every N hours"
              min={1}
              value={schedule.intervalHours}
              onValueChange={(intervalHours) => updateSchedule((current) => ({
                ...current,
                intervalHours,
              }))}
            />
            <span className="text-muted-foreground">hour(s) at minute</span>
            <TimeInput
              id="flow-hourly-minute"
              ariaLabel="Minute of the hour"
              max={59}
              value={schedule.minute}
              onValueChange={(minute) => updateSchedule((current) => ({ ...current, minute }))}
            />
          </>
        ) : null}

        {schedule.mode === 'daily' ? (
          <>
            <span className="text-muted-foreground">every</span>
            <NumberInput
              id="flow-interval-days"
              ariaLabel="Every N days"
              min={1}
              value={schedule.intervalDays}
              onValueChange={(intervalDays) => updateSchedule((current) => ({
                ...current,
                intervalDays,
              }))}
            />
            <span className="text-muted-foreground">day(s) at</span>
            <TimeInput
              id="flow-daily-hour"
              ariaLabel="Hour"
              max={23}
              value={schedule.hour}
              onValueChange={(hour) => updateSchedule((current) => ({ ...current, hour }))}
            />
            <span className="text-muted-foreground">:</span>
            <TimeInput
              id="flow-daily-minute"
              ariaLabel="Minute"
              max={59}
              value={schedule.minute}
              onValueChange={(minute) => updateSchedule((current) => ({ ...current, minute }))}
            />
          </>
        ) : null}

        {schedule.mode === 'weekly' ? (
          <>
            <span className="text-muted-foreground">at</span>
            <TimeInput
              id="flow-weekly-hour"
              ariaLabel="Hour"
              max={23}
              value={schedule.hour}
              onValueChange={(hour) => updateSchedule((current) => ({ ...current, hour }))}
            />
            <span className="text-muted-foreground">:</span>
            <TimeInput
              id="flow-weekly-minute"
              ariaLabel="Minute"
              max={59}
              value={schedule.minute}
              onValueChange={(minute) => updateSchedule((current) => ({ ...current, minute }))}
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
            <NumberInput
              id="flow-interval-months"
              ariaLabel="Every N months"
              min={1}
              value={schedule.intervalMonths}
              onValueChange={(intervalMonths) => updateSchedule((current) => ({
                ...current,
                intervalMonths,
              }))}
            />
            <span className="text-muted-foreground">month(s) on day</span>
            <NumberInput
              id="flow-monthly-day"
              ariaLabel="Day of month"
              min={1}
              max={31}
              value={schedule.dayOfMonth}
              onValueChange={(dayOfMonth) => updateSchedule((current) => ({
                ...current,
                dayOfMonth,
              }))}
            />
            <span className="text-muted-foreground">at</span>
            <TimeInput
              id="flow-monthly-hour"
              ariaLabel="Hour"
              max={23}
              value={schedule.hour}
              onValueChange={(hour) => updateSchedule((current) => ({ ...current, hour }))}
            />
            <span className="text-muted-foreground">:</span>
            <TimeInput
              id="flow-monthly-minute"
              ariaLabel="Minute"
              max={59}
              value={schedule.minute}
              onValueChange={(minute) => updateSchedule((current) => ({ ...current, minute }))}
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
