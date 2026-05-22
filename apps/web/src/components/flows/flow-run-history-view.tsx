'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Lightning, PencilSimple, SpinnerGap } from '@phosphor-icons/react'

import { FlowRunHistory } from '@/components/flows/flow-run-history'
import { Button } from '@/components/ui/button'
import { copyFlowRequest, fetchFlowDetail, runFlowRequest } from '@/lib/flows/client'
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
  const [isCopying, setIsCopying] = useState(false)

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
    let cancelled = false

    async function loadInitialFlow() {
      try {
        const result = await fetchFlowDetail(slug, flowId)
        if (cancelled) return

        if (!result.ok) {
          setError(result.error)
          return
        }
        setFlow(result.data.flow)
      } catch {
        if (!cancelled) {
          setError('network_error')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialFlow()

    return () => {
      cancelled = true
    }
  }, [flowId, slug])

  const runFlow = useCallback(async () => {
    if (!flow?.permissions.canRun) return
    if ((flow.missingConnectorRequirements ?? []).length > 0) {
      setActionError('missing_connectors')
      return
    }

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
  }, [flow, flowId, loadFlow, slug])

  const copyFlow = useCallback(async () => {
    if (!flow?.permissions.canCopy) return

    setIsCopying(true)
    setActionError(null)
    try {
      const result = await copyFlowRequest(slug, flowId)
      if (!result.ok) {
        setActionError(result.error)
        return
      }
      window.location.href = `/u/${slug}/flows/${result.data.flow.id}`
    } catch {
      setActionError('network_error')
    } finally {
      setIsCopying(false)
    }
  }, [flow, flowId, slug])

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
              {flow?.permissions.canEdit ? 'Edit flow' : 'View flow'}
            </Link>
          </Button>
          {flow?.permissions.canCopy ? (
            <Button variant="outline" onClick={() => void copyFlow()} disabled={isCopying}>
              {isCopying ? 'Copying...' : 'Copy flow'}
            </Button>
          ) : null}
          <Button
            onClick={() => void runFlow()}
            disabled={isRunning || !flow?.permissions.canRun || (flow.missingConnectorRequirements ?? []).length > 0}
            className="gap-2"
          >
            <Lightning size={14} weight="fill" />
            {isRunning ? 'Starting...' : 'Run flow'}
          </Button>
        </div>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      {flow && (flow.missingConnectorRequirements ?? []).length > 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Missing connectors: {(flow.missingConnectorRequirements ?? []).map((requirement) => requirement.connectorType).join(', ')}.
        </p>
      ) : null}

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
