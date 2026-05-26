'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ClockCountdown, ClockCounterClockwise, DotsThreeVertical, GitBranch, PencilSimple, Play, SpinnerGap, TreeStructure } from '@phosphor-icons/react'

import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { fetchFlowList, runFlowRequest } from '@/lib/flows/client'
import { formatFlowRunDate } from '@/lib/flows/cron'
import { getFlowErrorMessage } from '@/lib/flows/errors'
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null)

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

  const runFlow = useCallback(async (flowId: string) => {
    setRunningFlowId(flowId)
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
      setRunningFlowId(null)
    }
  }, [loadFlows, slug])

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
  const myFlows = useMemo(() => sortedFlows.filter((flow) => flow.permissions.isOwner), [sortedFlows])
  const teamFlows = useMemo(() => sortedFlows.filter((flow) => !flow.permissions.isOwner), [sortedFlows])

  function renderFlowGrid(items: FlowListItem[]) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((flow) => {
          const editLabel = flow.permissions.canEdit ? 'Edit' : 'View'
          const isRunning = runningFlowId === flow.id

          return (
            <article
              key={flow.id}
              className={cn(
                'group flex flex-col gap-4 rounded-xl border border-border/60 bg-card/50 p-5 transition-all hover:border-border hover:bg-card/80 hover:shadow-sm',
                !flow.enabled && 'opacity-80',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <Link
                      href={`/u/${slug}/flows/${flow.id}/runs`}
                      className="truncate text-sm font-semibold text-foreground transition-colors hover:text-foreground/80 hover:underline"
                    >
                      {flow.name}
                    </Link>
                    <Badge variant={getRunBadgeVariant(flow)} className="shrink-0">{getRunBadgeLabel(flow)}</Badge>
                    <Badge variant={flow.visibility === 'team' ? 'default' : 'secondary'} className="shrink-0">
                      {flow.visibility === 'team' ? 'Team' : 'Private'}
                    </Badge>
                    {flow.visibility === 'team' && flow.organizationCanRun ? <Badge variant="success" className="shrink-0">Runnable</Badge> : null}
                  </div>
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {flow.description ?? `${flow.definition.nodes.length} nodes, ${flow.definition.edges.length} edges`}
                  </p>
                  {!flow.permissions.isOwner && flow.owner ? (
                    <p className="text-xs text-muted-foreground/80">Shared by {flow.owner.slug}</p>
                  ) : null}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`More actions for ${flow.name}`}
                      className="-mr-1.5 -mt-1.5 h-8 w-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground data-[state=open]:bg-muted/60 data-[state=open]:text-foreground"
                    >
                      <DotsThreeVertical size={18} weight="bold" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem asChild>
                      <Link href={`/u/${slug}/flows/${flow.id}`} aria-label={`${editLabel} ${flow.name}`}>
                        <PencilSimple size={15} weight="bold" /> {editLabel}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/u/${slug}/flows/${flow.id}/runs`} aria-label={`View run history for ${flow.name}`}>
                        <ClockCounterClockwise size={15} weight="bold" /> History
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><TreeStructure size={13} weight="bold" />{flow.definition.nodes.length} nodes</span>
                  <span className="inline-flex items-center gap-1"><GitBranch size={13} weight="bold" />{flow.definition.edges.length} edges</span>
                  <span className="inline-flex items-center gap-1">
                    <ClockCountdown size={13} weight="bold" />
                    {flow.nextRunAt ? formatFlowRunDate(new Date(flow.nextRunAt), flow.timezone) : 'Manual'}
                  </span>
                </div>

                {flow.permissions.canRun ? (
                  <Button
                    size="sm"
                    onClick={() => void runFlow(flow.id)}
                    disabled={isRunning}
                    className="h-8 shrink-0 gap-1.5 px-3.5"
                  >
                    {isRunning ? <SpinnerGap size={14} className="animate-spin" /> : <Play size={14} weight="fill" />}
                    {isRunning ? 'Starting' : 'Run'}
                  </Button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    )
  }

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
            <CardDescription>{getFlowErrorMessage(loadError)}</CardDescription>
          </CardHeader>
          <CardContent><Button variant="outline" onClick={() => void loadFlows()}>Retry</Button></CardContent>
        </Card>
      ) : null}

      {actionError ? <p className="text-sm text-destructive">{getFlowErrorMessage(actionError)}</p> : null}

      {!isLoading && !loadError && sortedFlows.length === 0 ? (
        <DashboardEmptyState
          icon={GitBranch}
          title="No flows yet"
          description="Create a flow to run linear automations, pause for human input, branch on conditions and keep every run in one OpenCode session."
          primaryAction={{ href: `/u/${slug}/flows/new`, label: 'Create your first flow' }}
        />
      ) : null}

      {!isLoading && !loadError && sortedFlows.length > 0 ? (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">My flows</h2>
            {myFlows.length > 0 ? renderFlowGrid(myFlows) : <p className="text-sm text-muted-foreground">No private flows owned by you yet.</p>}
          </section>
          {teamFlows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Team flows</h2>
              {renderFlowGrid(teamFlows)}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
