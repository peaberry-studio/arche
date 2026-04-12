'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SpinnerGap } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import {
  buildAutopilotCronExpressionFromBuilder,
  createDefaultAutopilotScheduleBuilderState,
  formatAutopilotRunDate,
  getAutopilotTimeZoneOptions,
  getUpcomingAutopilotRunDates,
  inferAutopilotScheduleBuilderState,
} from '@/lib/autopilot/cron'
import type {
  AutopilotScheduleBuilderMode,
  AutopilotScheduleBuilderState,
  AutopilotTaskDetail,
} from '@/lib/autopilot/types'
import { cn } from '@/lib/utils'

type AutopilotTaskFormProps = {
  mode: 'create' | 'edit'
  slug: string
  taskId?: string
}

type ScheduleFormState = {
  customCronExpression: string
  dayOfMonth: number
  hour: number
  intervalDays: number
  intervalHours: number
  intervalMinutes: number
  intervalMonths: number
  minute: number
  mode: AutopilotScheduleBuilderMode
  weekdays: number[]
}

const WEEKDAY_OPTIONS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
]

function toScheduleFormState(builder: AutopilotScheduleBuilderState): ScheduleFormState {
  switch (builder.mode) {
    case 'minutes':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: 9,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: builder.intervalMinutes,
        intervalMonths: 1,
        minute: 0,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'hourly':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: 9,
        intervalDays: 1,
        intervalHours: builder.intervalHours,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'daily':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: builder.hour,
        intervalDays: builder.intervalDays,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'weekly':
      return {
        customCronExpression: '',
        dayOfMonth: 1,
        hour: builder.hour,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: builder.weekdays,
      }
    case 'monthly':
      return {
        customCronExpression: '',
        dayOfMonth: builder.dayOfMonth,
        hour: builder.hour,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: builder.intervalMonths,
        minute: builder.minute,
        mode: builder.mode,
        weekdays: [1],
      }
    case 'custom':
      return {
        customCronExpression: builder.cronExpression,
        dayOfMonth: 1,
        hour: 9,
        intervalDays: 1,
        intervalHours: 1,
        intervalMinutes: 15,
        intervalMonths: 1,
        minute: 0,
        mode: builder.mode,
        weekdays: [1],
      }
  }
}

function toBuilderState(state: ScheduleFormState): AutopilotScheduleBuilderState {
  switch (state.mode) {
    case 'minutes':
      return { mode: state.mode, intervalMinutes: state.intervalMinutes }
    case 'hourly':
      return {
        mode: state.mode,
        intervalHours: state.intervalHours,
        minute: state.minute,
      }
    case 'daily':
      return {
        mode: state.mode,
        intervalDays: state.intervalDays,
        hour: state.hour,
        minute: state.minute,
      }
    case 'weekly':
      return {
        mode: state.mode,
        weekdays: state.weekdays,
        hour: state.hour,
        minute: state.minute,
      }
    case 'monthly':
      return {
        mode: state.mode,
        intervalMonths: state.intervalMonths,
        dayOfMonth: state.dayOfMonth,
        hour: state.hour,
        minute: state.minute,
      }
    case 'custom':
      return { mode: state.mode, cronExpression: state.customCronExpression }
  }
}

function getDefaultScheduleFormState(): ScheduleFormState {
  return toScheduleFormState(createDefaultAutopilotScheduleBuilderState())
}

function getRunBadgeVariant(status: AutopilotTaskDetail['runs'][number]['status']): 'default' | 'success' | 'warning' {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'warning'
  return 'default'
}

function getRunBadgeLabel(status: AutopilotTaskDetail['runs'][number]['status']): string {
  if (status === 'succeeded') return 'Succeeded'
  if (status === 'failed') return 'Failed'
  return 'Running'
}

export function AutopilotTaskForm({ slug, mode, taskId }: AutopilotTaskFormProps) {
  const router = useRouter()
  const { agents } = useAgentsCatalog(slug)
  const timezoneOptions = useMemo(() => getAutopilotTimeZoneOptions(), [])
  const [task, setTask] = useState<AutopilotTaskDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRunningNow, setIsRunningNow] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [targetAgentId, setTargetAgentId] = useState<string>('')
  const [timezone, setTimezone] = useState('UTC')
  const [enabled, setEnabled] = useState(true)
  const [schedule, setSchedule] = useState<ScheduleFormState>(getDefaultScheduleFormState())

  const loadTask = useCallback(async () => {
    if (mode !== 'edit' || !taskId) {
      return
    }

    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${taskId}`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | { task?: AutopilotTaskDetail; error?: string }
        | null

      if (!response.ok || !data?.task) {
        setLoadError(data?.error ?? 'load_failed')
        return
      }

      setTask(data.task)
      setName(data.task.name)
      setPrompt(data.task.prompt)
      setTargetAgentId(data.task.targetAgentId ?? '')
      setTimezone(data.task.timezone)
      setEnabled(data.task.enabled)
      setSchedule(toScheduleFormState(inferAutopilotScheduleBuilderState(data.task.cronExpression)))
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [mode, slug, taskId])

  useEffect(() => {
    void loadTask()
  }, [loadTask])

  const cronExpression = useMemo(
    () => buildAutopilotCronExpressionFromBuilder(toBuilderState(schedule)),
    [schedule],
  )

  const nextRuns = useMemo(() => {
    try {
      return getUpcomingAutopilotRunDates(cronExpression, timezone, new Date(), 3)
    } catch {
      return []
    }
  }, [cronExpression, timezone])

  const isScheduleValid = nextRuns.length > 0

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setFormError(null)

    try {
      const response = await fetch(
        mode === 'create' ? `/api/u/${slug}/autopilot` : `/api/u/${slug}/autopilot/${taskId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cronExpression,
            enabled,
            name,
            prompt,
            targetAgentId: targetAgentId || null,
            timezone,
          }),
        },
      )

      const data = (await response.json().catch(() => null)) as
        | { task?: AutopilotTaskDetail; error?: string }
        | null

      if (!response.ok || !data?.task) {
        setFormError(data?.error ?? 'save_failed')
        return
      }

      setTask(data.task)
      if (mode === 'create') {
        router.push(`/u/${slug}/autopilot/${data.task.id}`)
        return
      }

      await loadTask()
    } catch {
      setFormError('network_error')
    } finally {
      setIsSaving(false)
    }
  }, [cronExpression, enabled, loadTask, mode, name, prompt, router, slug, targetAgentId, taskId, timezone])

  const handleDelete = useCallback(async () => {
    if (mode !== 'edit' || !taskId) {
      return
    }

    setIsDeleting(true)
    setFormError(null)
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${taskId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setFormError(data?.error ?? 'delete_failed')
        return
      }

      router.push(`/u/${slug}/autopilot`)
    } catch {
      setFormError('network_error')
    } finally {
      setIsDeleting(false)
    }
  }, [mode, router, slug, taskId])

  const handleRunNow = useCallback(async () => {
    if (mode !== 'edit' || !taskId) {
      return
    }

    setIsRunningNow(true)
    setFormError(null)
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${taskId}/run`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setFormError(data?.error ?? 'run_failed')
        return
      }

      await loadTask()
    } catch {
      setFormError('network_error')
    } finally {
      setIsRunningNow(false)
    }
  }, [loadTask, mode, slug, taskId])

  const setScheduleMode = useCallback((nextMode: AutopilotScheduleBuilderMode) => {
    setSchedule((current) => ({
      ...current,
      customCronExpression:
        nextMode === 'custom'
          ? buildAutopilotCronExpressionFromBuilder(toBuilderState(current))
          : current.customCronExpression,
      mode: nextMode,
    }))
  }, [])

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          Loading autopilot task...
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load autopilot task</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void loadTask()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{mode === 'create' ? 'New autopilot task' : 'Task settings'}</CardTitle>
          <CardDescription>
            Configure a recurring prompt, target agent, cron schedule and timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="autopilot-name">Task name</Label>
              <Input
                id="autopilot-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Daily KPI summary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="autopilot-agent">Target agent</Label>
              <div className="relative">
                <select
                  id="autopilot-agent"
                  value={targetAgentId}
                  onChange={(event) => setTargetAgentId(event.target.value)}
                  className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
                >
                  <option value="">Primary agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="autopilot-timezone">Timezone</Label>
              <Input
                id="autopilot-timezone"
                list="autopilot-timezones"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="Europe/Madrid"
              />
              <datalist id="autopilot-timezones">
                {timezoneOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/30 p-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Schedule</Label>
                <div className="flex flex-wrap gap-2">
                  {(['minutes', 'hourly', 'daily', 'weekly', 'monthly', 'custom'] as const).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setScheduleMode(entry)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm capitalize transition-colors',
                        schedule.mode === entry
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {entry}
                    </button>
                  ))}
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      {WEEKDAY_OPTIONS.map((option) => {
                        const selected = schedule.weekdays.includes(option.value)
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setSchedule((current) => ({
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
                        onChange={(event) => setSchedule((current) => ({
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
                        onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                      onChange={(event) => setSchedule((current) => ({
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
                    onChange={(event) => setSchedule((current) => ({
                      ...current,
                      customCronExpression: event.target.value,
                    }))}
                    placeholder="0 9 * * 1-5"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use standard 5-field cron format: minute hour day-of-month month day-of-week.
                  </p>
                </div>
              ) : null}

              <div className="border-t border-border/40 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">Resolved cron</p>
                  <code className="rounded-md bg-background/80 px-2.5 py-1 font-mono text-xs text-foreground">
                    {cronExpression}
                  </code>
                </div>
                {isScheduleValid && nextRuns.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-muted-foreground">Upcoming runs ({timezone})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {nextRuns.map((runAt) => (
                        <Badge key={runAt.toISOString()} variant="outline" className="font-normal">
                          {formatAutopilotRunDate(runAt, timezone)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : !isScheduleValid ? (
                  <p className="mt-2 text-xs text-destructive">
                    The cron expression or timezone is invalid.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="autopilot-prompt">Prompt</Label>
            <textarea
              id="autopilot-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              className="min-h-[180px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder="Summarize the most important updates from the knowledge base and propose the next actions."
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Disabled tasks stay saved but will not execute on schedule.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable autopilot task" />
          </div>

          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}

          <div className="flex items-center justify-between border-t border-border/40 pt-5">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleSave()} disabled={isSaving || !isScheduleValid}>
                {isSaving ? 'Saving...' : mode === 'create' ? 'Create task' : 'Save changes'}
              </Button>

              {mode === 'edit' && taskId ? (
                <Button variant="outline" onClick={() => void handleRunNow()} disabled={isRunningNow}>
                  {isRunningNow ? 'Running...' : 'Run now'}
                </Button>
              ) : null}

              <Button variant="outline" asChild>
                <Link href={`/u/${slug}/autopilot`}>Back to list</Link>
              </Button>
            </div>

            {mode === 'edit' && taskId ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="text-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete task'}
              </button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {mode === 'edit' && task ? (
        <Card>
          <CardHeader>
            <CardTitle>Run history</CardTitle>
            <CardDescription>
              Every execution creates a dedicated OpenCode session linked back to this task.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {task.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {task.runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-border/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getRunBadgeVariant(run.status)}>{getRunBadgeLabel(run.status)}</Badge>
                          <Badge variant="outline">{run.trigger}</Badge>
                        </div>
                        <p className="text-foreground">
                          Scheduled for {formatAutopilotRunDate(new Date(run.scheduledFor), task.timezone)}
                        </p>
                        <p className="text-muted-foreground">
                          Started {formatAutopilotRunDate(new Date(run.startedAt), task.timezone)}
                        </p>
                        {run.error ? (
                          <p className="text-destructive">{run.error}</p>
                        ) : null}
                      </div>

                      {run.openCodeSessionId ? (
                        <Button variant="outline" asChild>
                          <Link href={`/w/${slug}?session=${encodeURIComponent(run.openCodeSessionId)}`}>
                            Open session
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
