'use client'

import { useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { cancelFlowRunRequest, submitHumanResponseRequest } from '@/lib/flows/client'
import type { FlowRunListItem } from '@/lib/flows/types'

type HumanStepResponseCardProps = {
  run: FlowRunListItem
  slug: string
  onSubmitted?: () => Promise<void> | void
}

export function HumanStepResponseCard({ run, slug, onSubmitted }: HumanStepResponseCardProps) {
  const [response, setResponse] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const currentStep = run.steps.find((step) => step.nodeId === run.currentNodeId)

  if (run.status !== 'waiting_for_human' || !currentStep) return null

  const instructions = currentStep.input && typeof currentStep.input === 'object' && !Array.isArray(currentStep.input)
    ? (currentStep.input as { instructions?: unknown }).instructions
    : null
  const stepLabel = currentStep.nodeName ?? currentStep.nodeId

  async function submitResponse() {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await submitHumanResponseRequest(slug, run.id, response)
      if (!result.ok) {
        setError(result.error)
        return
      }

      setResponse('')
      await onSubmitted?.()
    } catch {
      setError('network_error')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function cancelRun() {
    setIsCancelling(true)
    setError(null)

    try {
      const result = await cancelFlowRunRequest(slug, run.id)
      if (!result.ok) {
        setError(result.error)
        return
      }

      await onSubmitted?.()
    } catch {
      setError('network_error')
    } finally {
      setIsCancelling(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isSubmitting) {
      event.preventDefault()
      void submitResponse()
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Waiting for human input</h3>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span className="truncate text-xs text-muted-foreground">{stepLabel}</span>
      </div>

      {typeof instructions === 'string' && instructions.trim() ? (
        <p className="mt-2 text-sm text-muted-foreground">{instructions}</p>
      ) : null}

      <textarea
        value={response}
        onChange={(event) => setResponse(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        className="mt-4 min-h-[96px] w-full resize-y rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        placeholder="Enter the human response for this step."
      />

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => void submitResponse()}
          disabled={isSubmitting || isCancelling}
        >
          {isSubmitting ? 'Resuming...' : 'Submit and resume'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void cancelRun()}
          disabled={isSubmitting || isCancelling}
        >
          {isCancelling ? 'Cancelling...' : 'Cancel run'}
        </Button>
        {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      </div>
    </div>
  )
}
