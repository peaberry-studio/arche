'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { submitHumanResponseRequest } from '@/lib/flows/client'
import type { FlowRunListItem } from '@/lib/flows/types'

type HumanStepResponseCardProps = {
  run: FlowRunListItem
  slug: string
  onSubmitted?: () => Promise<void> | void
}

export function HumanStepResponseCard({ run, slug, onSubmitted }: HumanStepResponseCardProps) {
  const [response, setResponse] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const currentStep = run.steps.find((step) => step.nodeId === run.currentNodeId)

  if (run.status !== 'waiting_for_human' || !currentStep) return null

  const instructions = currentStep.input && typeof currentStep.input === 'object' && !Array.isArray(currentStep.input)
    ? (currentStep.input as { instructions?: unknown }).instructions
    : null

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

  return (
    <Card className="border-amber-400/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle>Waiting for human input</CardTitle>
        <CardDescription>{currentStep.nodeName ?? currentStep.nodeId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {typeof instructions === 'string' ? (
          <p className="text-sm text-foreground/80">{instructions}</p>
        ) : null}
        <textarea
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          rows={4}
          className="min-h-[110px] w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="Enter the human response for this step."
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button onClick={() => void submitResponse()} disabled={isSubmitting}>
          {isSubmitting ? 'Resuming...' : 'Submit and resume'}
        </Button>
      </CardContent>
    </Card>
  )
}
