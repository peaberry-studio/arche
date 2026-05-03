'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SpinnerGap } from '@phosphor-icons/react'

import { AutopilotRunHistory } from '@/components/autopilot/autopilot-run-history'
import { AutopilotScheduleBuilder } from '@/components/autopilot/autopilot-schedule-builder'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import {
  getAutopilotTimeZoneOptions,
} from '@/lib/autopilot/cron'
import {
  getAutopilotSchedulePreview,
  getDefaultAutopilotScheduleFormState,
  inferAutopilotScheduleFormState,
  type AutopilotScheduleFormState,
} from '@/lib/autopilot/schedule-form'
import type { AutopilotTaskDetail } from '@/lib/autopilot/types'

type AutopilotTaskFormProps = {
  mode: 'create' | 'edit'
  slug: string
  taskId?: string
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
  const [schedule, setSchedule] = useState<AutopilotScheduleFormState>(getDefaultAutopilotScheduleFormState())

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
      setSchedule(inferAutopilotScheduleFormState(data.task.cronExpression))
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [mode, slug, taskId])

  useEffect(() => {
    void loadTask()
  }, [loadTask])

  const schedulePreview = useMemo(
    () => getAutopilotSchedulePreview(schedule, timezone),
    [schedule, timezone],
  )
  const cronExpression = schedulePreview.cronExpression
  const isScheduleValid = schedulePreview.isValid

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
    <div className="space-y-8">
      <div className="space-y-6">
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
                className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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

        <AutopilotScheduleBuilder
          preview={schedulePreview}
          schedule={schedule}
          timezone={timezone}
          onChange={setSchedule}
        />

        <div className="space-y-2">
          <Label htmlFor="autopilot-prompt">Prompt</Label>
          <textarea
            id="autopilot-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={8}
            className="min-h-[180px] w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
            placeholder="Summarize the most important updates from the knowledge base and propose the next actions."
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-3">
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
      </div>

      {mode === 'edit' && task ? <AutopilotRunHistory slug={slug} task={task} /> : null}
    </div>
  )
}
