'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Lightning, PencilSimple, SpinnerGap } from '@phosphor-icons/react'

import { FlowRunHistory } from '@/components/flows/flow-run-history'
import { Button } from '@/components/ui/button'
import { fetchFlowDetail, runFlowRequest } from '@/lib/flows/client'
import type { FlowDetail } from '@/lib/flows/types'

type FlowRunHistoryViewProps = {
  flowId: string
  slug: string
}

export function FlowRunHistoryView({ flowId, slug }: FlowRunHistoryViewProps) {
  const [flow, setFlow] = useState<FlowDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const loadFlow = useCallback(async () => {
    setError(null)
    try {
      const result = await fetchFlowDetail(slug, flowId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFlow(result.data.flow)
    } catch {
      setError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [flowId, slug])

  useEffect(() => {
    void loadFlow()
  }, [loadFlow])

  const runFlow = useCallback(async () => {
    setIsRunning(true)
    setActionError(null)
    try {
      const result = await runFlowRequest(slug, flowId)
      if (!result.ok) {
        setActionError(result.error)
        return
      }
      await loadFlow()
    } catch {
      setActionError('network_error')
    } finally {
      setIsRunning(false)
    }
  }, [flowId, loadFlow, slug])

  const editHref = `/u/${slug}/flows/${flowId}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="type-display text-3xl font-semibold tracking-tight">Run history</h1>
          <p className="text-muted-foreground">
            Each run executes in one OpenCode session and records every node step.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" asChild className="gap-2">
            <Link href={editHref}>
              <PencilSimple size={14} weight="bold" />
              Edit flow
            </Link>
          </Button>
          <Button
            onClick={() => void runFlow()}
            disabled={isRunning || !flow}
            className="gap-2"
          >
            <Lightning size={14} weight="fill" />
            {isRunning ? 'Starting...' : 'Run flow'}
          </Button>
        </div>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      {isLoading && !flow ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin" />
            Loading runs...
          </div>
        </div>
      ) : null}

      {!isLoading && !flow ? (
        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <p className="text-sm font-semibold text-foreground">Could not load runs</p>
          <p className="mt-1 text-sm text-muted-foreground">{error ?? 'not_found'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadFlow()}>Retry</Button>
        </div>
      ) : null}

      {flow ? <FlowRunHistory flow={flow} slug={slug} onRefresh={loadFlow} /> : null}
    </div>
  )
}
