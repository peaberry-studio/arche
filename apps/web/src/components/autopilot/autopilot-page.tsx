'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SpinnerGap } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatAutopilotRunDate } from '@/lib/autopilot/cron'
import type { AutopilotTaskListItem } from '@/lib/autopilot/types'

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
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      })

      if (!response.ok) {
        return
      }

      await loadTasks()
    } finally {
      markMutating(task.id, false)
    }
  }, [loadTasks, markMutating, slug])

  const handleRunNow = useCallback(async (taskId: string) => {
    markMutating(taskId, true)
    try {
      await fetch(`/api/u/${slug}/autopilot/${taskId}/run`, {
        method: 'POST',
      })
      await loadTasks()
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

      {!isLoading && !loadError && sortedTasks.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No autopilot tasks yet</CardTitle>
            <CardDescription>
              Create your first recurring prompt to start running background automations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push(`/u/${slug}/autopilot/new`)}>
              Create task
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !loadError && sortedTasks.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedTasks.map((task) => {
            const isMutating = mutatingTaskIds.has(task.id)
            return (
              <Card key={task.id}>
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="truncate">{task.name}</CardTitle>
                      <CardDescription className="line-clamp-2">{task.prompt}</CardDescription>
                    </div>
                    <Badge variant={getRunBadgeVariant(task)}>{getRunBadgeLabel(task)}</Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-2 text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">Cron:</span> {task.cronExpression}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Timezone:</span> {task.timezone}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Target:</span>{' '}
                      {task.targetAgentId ?? 'Primary agent'}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Next run:</span>{' '}
                      {formatAutopilotRunDate(new Date(task.nextRunAt), task.timezone)}
                    </p>
                    {task.latestRun ? (
                      <p>
                        <span className="font-medium text-foreground">Latest run:</span>{' '}
                        {formatAutopilotRunDate(new Date(task.latestRun.startedAt), task.timezone)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" asChild>
                      <Link href={`/u/${slug}/autopilot/${task.id}`}>Open</Link>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleRunNow(task.id)}
                      disabled={isMutating}
                    >
                      Run now
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleToggleEnabled(task)}
                      disabled={isMutating}
                    >
                      {task.enabled ? 'Pause' : 'Enable'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
