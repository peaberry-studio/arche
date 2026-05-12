'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ClockCountdown, GitBranch, Lightning, Pause, Play, SpinnerGap, TreeStructure } from '@phosphor-icons/react'

import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchFlowList, runFlowRequest, updateFlowRequest } from '@/lib/flows/client'
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutatingFlowIds, setMutatingFlowIds] = useState<Set<string>>(new Set())

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
      setActionError(null)
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadFlows()
  }, [loadFlows])

  const markMutating = useCallback((flowId: string, active: boolean) => {
    setMutatingFlowIds((current) => {
      const next = new Set(current)
      if (active) next.add(flowId)
      else next.delete(flowId)
      return next
    })
  }, [])

  const handleToggleEnabled = useCallback(async (flow: FlowListItem) => {
    markMutating(flow.id, true)
    setActionError(null)
    try {
      const result = await updateFlowRequest(slug, flow.id, { enabled: !flow.enabled })
      if (!result.ok) {
        setActionError(result.error)
        return
      }

      await loadFlows()
    } catch {
      setActionError('network_error')
    } finally {
      markMutating(flow.id, false)
    }
  }, [loadFlows, markMutating, slug])

  const handleRunNow = useCallback(async (flowId: string) => {
    markMutating(flowId, true)
    setActionError(null)
    try {
      const result = await runFlowRequest(slug, flowId)
      if (!result.ok) {
        setActionError(result.error)
        return
      }

      await loadFlows()
    } catch {
      setActionError('network_error')
    } finally {
      markMutating(flowId, false)
    }
  }, [loadFlows, markMutating, slug])

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

      {actionError ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not complete flow action</CardTitle>
            <CardDescription>{actionError}</CardDescription>
          </CardHeader>
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
          {sortedFlows.map((flow) => {
            const isMutating = mutatingFlowIds.has(flow.id)
            return (
              <Link key={flow.id} href={`/u/${slug}/flows/${flow.id}`} className="group block">
                <div className={cn(
                  'rounded-xl border border-border/60 bg-card/50 p-5 transition-all hover:border-border hover:bg-card/80 hover:shadow-sm',
                  !flow.enabled && 'opacity-80',
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{flow.name}</h3>
                        <Badge variant={getRunBadgeVariant(flow)} className="shrink-0">{getRunBadgeLabel(flow)}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {flow.description ?? `${flow.definition.nodes.length} nodes, ${flow.definition.edges.length} edges`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><TreeStructure size={13} weight="bold" />{flow.definition.nodes.length} nodes</span>
                    <span className="inline-flex items-center gap-1"><GitBranch size={13} weight="bold" />{flow.definition.edges.length} edges</span>
                    <span className="inline-flex items-center gap-1">
                      <ClockCountdown size={13} weight="bold" />
                      {flow.nextRunAt ? formatFlowRunDate(new Date(flow.nextRunAt), flow.timezone) : 'Manual'}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-2" onClick={(event) => event.preventDefault()}>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(event) => { event.preventDefault(); void handleRunNow(flow.id) }} disabled={isMutating}>
                      <Lightning size={12} weight="fill" className="mr-1" /> Run now
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(event) => { event.preventDefault(); void handleToggleEnabled(flow) }} disabled={isMutating}>
                      {flow.enabled ? <><Pause size={12} weight="fill" className="mr-1" /> Pause</> : <><Play size={12} weight="fill" className="mr-1" /> Schedule</>}
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
