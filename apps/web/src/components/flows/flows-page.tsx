'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ClockCountdown, GitBranch, PencilSimple, SpinnerGap, TreeStructure } from '@phosphor-icons/react'

import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchFlowList } from '@/lib/flows/client'
import { formatFlowRunDate } from '@/lib/flows/cron'
import type { FlowListItem } from '@/lib/flows/types'
import { cn } from '@/lib/utils'

type FlowsPageProps = {
  slug: string
}

function getRunBadgeVariant(flow: FlowListItem): 'default' | 'secondary' | 'success' | 'warning' {
  if (!flow.enabled) return 'secondary'
  if (!flow.latestRun) return 'default'
  if (flow.latestRun.status === 'succeeded') return 'success'
  if (flow.latestRun.status === 'failed' || flow.latestRun.status === 'cancelled') return 'warning'
  if (flow.latestRun.status === 'waiting_for_human') return 'secondary'
  return 'default'
}

function getRunBadgeLabel(flow: FlowListItem): string {
  if (!flow.enabled) return 'Manual only'
  if (!flow.latestRun) return 'Scheduled'
  if (flow.latestRun.status === 'waiting_for_human') return 'Waiting for human'
  if (flow.latestRun.status === 'running') return 'Running'
  if (flow.latestRun.status === 'succeeded') return 'Last run OK'
  return 'Last run failed'
}

export function FlowsPage({ slug }: FlowsPageProps) {
  const [flows, setFlows] = useState<FlowListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadFlows = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await fetchFlowList(slug)
      if (!result.ok) {
        setLoadError(result.error)
        return
      }

      setFlows(result.data.flows)
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialFlows() {
      try {
        const result = await fetchFlowList(slug)
        if (cancelled) return

        if (!result.ok) {
          setLoadError(result.error)
          return
        }

        setFlows(result.data.flows)
      } catch {
        if (!cancelled) {
          setLoadError('network_error')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialFlows()

    return () => {
      cancelled = true
    }
  }, [slug])

  const sortedFlows = useMemo(() => [...flows].sort((left, right) => left.name.localeCompare(right.name)), [flows])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="type-display text-3xl font-semibold tracking-tight">Flows</h1>
          <p className="text-muted-foreground">
            Build multi-step automations with agent steps, human pauses, conditions and visual routing.
          </p>
        </div>

        <Button variant="outline" asChild>
          <Link href={`/u/${slug}/flows/new`}>Create flow</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin" /> Loading flows...
          </div>
        </div>
      ) : null}

      {loadError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load flows</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent><Button variant="outline" onClick={() => void loadFlows()}>Retry</Button></CardContent>
        </Card>
      ) : null}

      {!isLoading && !loadError && sortedFlows.length === 0 ? (
        <DashboardEmptyState
          icon={GitBranch}
          title="No flows yet"
          description="Create a flow to run linear automations, pause for human input, branch on conditions and keep every run in one OpenCode session."
          primaryAction={{ href: `/u/${slug}/flows/new`, label: 'Create your first flow' }}
        />
      ) : null}

      {!isLoading && !loadError && sortedFlows.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedFlows.map((flow) => (
            <article
              key={flow.id}
              className={cn(
                'group relative rounded-xl border border-border/60 bg-card/50 p-5 transition-all hover:border-border hover:bg-card/80 hover:shadow-sm',
                !flow.enabled && 'opacity-80',
              )}
            >
              <Link
                href={`/u/${slug}/flows/${flow.id}/runs`}
                aria-label={`View run history for ${flow.name}`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />

              <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">{flow.name}</h3>
                    <Badge variant={getRunBadgeVariant(flow)} className="shrink-0">{getRunBadgeLabel(flow)}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {flow.description ?? `${flow.definition.nodes.length} nodes, ${flow.definition.edges.length} edges`}
                  </p>
                </div>
                <Link
                  href={`/u/${slug}/flows/${flow.id}`}
                  aria-label={`Edit ${flow.name}`}
                  className="pointer-events-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <PencilSimple size={12} weight="bold" /> Edit
                </Link>
              </div>

              <div className="pointer-events-none relative z-10 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><TreeStructure size={13} weight="bold" />{flow.definition.nodes.length} nodes</span>
                <span className="inline-flex items-center gap-1"><GitBranch size={13} weight="bold" />{flow.definition.edges.length} edges</span>
                <span className="inline-flex items-center gap-1">
                  <ClockCountdown size={13} weight="bold" />
                  {flow.nextRunAt ? formatFlowRunDate(new Date(flow.nextRunAt), flow.timezone) : 'Manual'}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
