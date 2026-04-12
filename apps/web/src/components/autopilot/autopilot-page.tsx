'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClockCountdown, Lightning, Pause, Play, Robot, SpinnerGap, Timer } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatAutopilotRunDate } from '@/lib/autopilot/cron'
import type { AutopilotTaskListItem } from '@/lib/autopilot/types'
import { cn } from '@/lib/utils'

type AutopilotPageProps = {
  slug: string
}

function getRunBadgeVariant(task: AutopilotTaskListItem): 'default' | 'secondary' | 'success' | 'warning' {
  if (!task.enabled) return 'secondary'
  if (!task.latestRun) return 'default'
  if (task.latestRun.status === 'succeeded') return 'success'
  if (task.latestRun.status === 'failed') return 'warning'
  return 'default'
}

function getRunBadgeLabel(task: AutopilotTaskListItem): string {
  if (!task.enabled) return 'Paused'
  if (!task.latestRun) return 'Scheduled'
  if (task.latestRun.status === 'running') return 'Running'
  if (task.latestRun.status === 'succeeded') return 'Last run OK'
  return 'Last run failed'
}

export function AutopilotPage({ slug }: AutopilotPageProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<AutopilotTaskListItem[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutatingTaskIds, setMutatingTaskIds] = useState<Set<string>>(new Set())

  const loadTasks = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/u/${slug}/autopilot`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | { tasks?: AutopilotTaskListItem[]; error?: string }
        | null

      if (!response.ok || !data?.tasks) {
        setLoadError(data?.error ?? 'load_failed')
        return
      }

      setTasks(data.tasks)
      setActionError(null)
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const markMutating = useCallback((taskId: string, active: boolean) => {
    setMutatingTaskIds((current) => {
      const next = new Set(current)
      if (active) {
        next.add(taskId)
      } else {
        next.delete(taskId)
      }
      return next
    })
  }, [])

  const handleToggleEnabled = useCallback(async (task: AutopilotTaskListItem) => {
    markMutating(task.id, true)
    setActionError(null)

    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setActionError(data?.error ?? 'toggle_failed')
        return
      }

      await loadTasks()
    } catch {
      setActionError('network_error')
    } finally {
      markMutating(task.id, false)
    }
  }, [loadTasks, markMutating, slug])

  const handleRunNow = useCallback(async (taskId: string) => {
    markMutating(taskId, true)
    setActionError(null)

    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${taskId}/run`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setActionError(data?.error ?? 'run_failed')
        return
      }

      await loadTasks()
    } catch {
      setActionError('network_error')
    } finally {
      markMutating(taskId, false)
    }
  }, [loadTasks, markMutating, slug])

  const sortedTasks = useMemo(
    () => [...tasks].sort((left, right) => left.name.localeCompare(right.name)),
    [tasks],
  )

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="type-display text-3xl font-semibold tracking-tight">Autopilot</h1>
          <p className="text-muted-foreground">
            Run recurring prompts in the background on a cron schedule with timezone-aware execution.
          </p>
        </div>

        <Button asChild>
          <Link href={`/u/${slug}/autopilot/new`}>Create task</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin" />
            Loading autopilot tasks...
          </div>
        </div>
      ) : null}

      {loadError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load autopilot</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void loadTasks()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {actionError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not complete autopilot action</CardTitle>
            <CardDescription>{actionError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!isLoading && !loadError && sortedTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-16 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Robot size={28} weight="duotone" className="text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">No autopilot tasks yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Autopilot runs recurring prompts in the background on a cron schedule.
            Use it to automate daily summaries, periodic checks, scheduled reports, and more.
          </p>
          <Button className="mt-6" onClick={() => router.push(`/u/${slug}/autopilot/new`)}>
            Create your first task
          </Button>
        </div>
      ) : null}

      {!isLoading && !loadError && sortedTasks.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedTasks.map((task) => {
            const isMutating = mutatingTaskIds.has(task.id)
            return (
              <Link
                key={task.id}
                href={`/u/${slug}/autopilot/${task.id}`}
                className="group block"
              >
                <div className={cn(
                  'rounded-xl border border-border/60 bg-card/50 p-5 transition-all hover:border-border hover:bg-card/80 hover:shadow-sm',
                  !task.enabled && 'opacity-70',
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{task.name}</h3>
                        <Badge variant={getRunBadgeVariant(task)} className="shrink-0">{getRunBadgeLabel(task)}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{task.prompt}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Timer size={13} weight="bold" className="shrink-0" />
                      <code className="text-foreground/70">{task.cronExpression}</code>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ClockCountdown size={13} weight="bold" className="shrink-0" />
                      {formatAutopilotRunDate(new Date(task.nextRunAt), task.timezone)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Robot size={13} weight="bold" className="shrink-0" />
                      {task.targetAgentId ?? 'Primary agent'}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-2" onClick={(e) => e.preventDefault()}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.preventDefault()
                        void handleRunNow(task.id)
                      }}
                      disabled={isMutating}
                    >
                      <Lightning size={12} weight="fill" className="mr-1" />
                      Run now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.preventDefault()
                        void handleToggleEnabled(task)
                      }}
                      disabled={isMutating}
                    >
                      {task.enabled ? (
                        <><Pause size={12} weight="fill" className="mr-1" /> Pause</>
                      ) : (
                        <><Play size={12} weight="fill" className="mr-1" /> Enable</>
                      )}
                    </Button>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
