'use client'

import { useCallback, useEffect, useState } from 'react'

import { HumanStepResponseCard } from '@/components/flows/human-step-response-card'
import { Button } from '@/components/ui/button'
import { fetchFlowRunRequest } from '@/lib/flows/client'
import type { FlowRunListItem } from '@/lib/flows/types'

type FlowHumanResponsePanelProps = {
  runId: string
  slug: string
  onSubmitted?: () => Promise<void> | void
}

export function FlowHumanResponsePanel({ runId, slug, onSubmitted }: FlowHumanResponsePanelProps) {
  const [run, setRun] = useState<FlowRunListItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadRun = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchFlowRunRequest(slug, runId)

      if (!result.ok) {
        setRun(null)
        setError(result.error)
        return
      }

      setRun(result.data.run)
    } catch {
      setRun(null)
      setError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [runId, slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialRun() {
      try {
        const result = await fetchFlowRunRequest(slug, runId)
        if (cancelled) return

        if (!result.ok) {
          setRun(null)
          setError(result.error)
          return
        }

        setRun(result.data.run)
      } catch {
        if (cancelled) return
        setRun(null)
        setError('network_error')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialRun()

    return () => {
      cancelled = true
    }
  }, [runId, slug])

  async function handleSubmitted() {
    try {
      await loadRun()
    } finally {
      await onSubmitted?.()
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
        Loading human input...
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <p className="text-destructive">Unable to load human input: {error}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void loadRun()}>
          Retry
        </Button>
      </div>
    )
  }

  if (!run || run.status !== 'waiting_for_human') {
    return (
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
        This flow run no longer needs human input. It may still be finishing.
      </div>
    )
  }

  return <HumanStepResponseCard run={run} slug={slug} onSubmitted={handleSubmitted} />
}
