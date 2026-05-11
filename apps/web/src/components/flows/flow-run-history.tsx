'use client'

import Link from 'next/link'

import { HumanStepResponseCard } from '@/components/flows/human-step-response-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatFlowRunDate } from '@/lib/flows/cron'
import type { FlowDetail, FlowRunListItem } from '@/lib/flows/types'
import { getWorkspaceHref } from '@/lib/workspace-hrefs'

type FlowRunHistoryProps = {
  flow: FlowDetail
  slug: string
  onRefresh?: () => Promise<void> | void
}

function getRunBadgeVariant(status: FlowRunListItem['status']): 'default' | 'success' | 'warning' | 'secondary' {
  if (status === 'succeeded') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'warning'
  if (status === 'waiting_for_human') return 'secondary'
  return 'default'
}

function getRunBadgeLabel(status: FlowRunListItem['status']): string {
  if (status === 'waiting_for_human') return 'Waiting for human'
  return status.replaceAll('_', ' ')
}

export function FlowRunHistory({ flow, slug, onRefresh }: FlowRunHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run history</CardTitle>
        <CardDescription>Every flow run executes in one OpenCode session and records every node step.</CardDescription>
      </CardHeader>
      <CardContent>
        {flow.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {flow.runs.map((run) => (
              <div key={run.id} className="space-y-3 rounded-xl border border-border/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getRunBadgeVariant(run.status)}>{getRunBadgeLabel(run.status)}</Badge>
                      <Badge variant="outline">{run.trigger}</Badge>
                    </div>
                    <p className="text-foreground">
                      Scheduled for {formatFlowRunDate(new Date(run.scheduledFor), flow.timezone)}
                    </p>
                    <p className="text-muted-foreground">
                      Started {formatFlowRunDate(new Date(run.startedAt), flow.timezone)}
                    </p>
                    {run.error ? <p className="text-destructive">{run.error}</p> : null}
                  </div>

                  {run.openCodeSessionId ? (
                    <Button variant="outline" asChild>
                      <Link href={getWorkspaceHref(slug, { mode: 'flows', sessionId: run.openCodeSessionId })}>
                        Open session
                      </Link>
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  {run.steps.map((step) => (
                    <div key={step.id} className="rounded-lg border border-border/50 bg-card/40 p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">{step.nodeName ?? step.nodeId}</span>
                        <Badge variant="outline">{step.status}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{step.nodeType}</p>
                      {step.compactedOutput ? <p className="mt-2 line-clamp-2 text-muted-foreground">Compact: {step.compactedOutput}</p> : null}
                      {!step.compactedOutput && step.rawOutput ? <p className="mt-2 line-clamp-2 text-muted-foreground">{step.rawOutput}</p> : null}
                      {step.humanResponse ? <p className="mt-2 line-clamp-2 text-muted-foreground">Human: {step.humanResponse}</p> : null}
                      {step.error ? <p className="mt-2 text-destructive">{step.error}</p> : null}
                    </div>
                  ))}
                </div>

                <HumanStepResponseCard run={run} slug={slug} onSubmitted={onRefresh} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
