'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatAutopilotRunDate } from '@/lib/autopilot/cron'
import type { AutopilotTaskDetail } from '@/lib/autopilot/types'
import { getWorkspaceHref } from '@/lib/workspace-hrefs'

type AutopilotRunHistoryProps = {
  slug: string
  task: AutopilotTaskDetail
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

export function AutopilotRunHistory({ slug, task }: AutopilotRunHistoryProps) {
  return (
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
                      <Link href={getWorkspaceHref(slug, { mode: 'tasks', sessionId: run.openCodeSessionId })}>
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
  )
}
