'use client'

import { useMemo } from 'react'

import { parseChartSpec } from '@/components/workspace/chat-panel/chart-output'
import { VegaFigure } from '@/components/workspace/vega-figure'

type MarkdownChartProps = {
  source: string
}

export function MarkdownChart({ source }: MarkdownChartProps) {
  const trimmed = source.trim()

  const spec = useMemo(() => {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
    return parseChartSpec(parsed)
  }, [trimmed])

  if (!spec) {
    return (
      <div className="my-2">
        <pre className="overflow-x-auto rounded-lg border border-border/40 bg-muted/15 px-3 pb-3 pt-3">
          <code className="text-xs">{trimmed}</code>
        </pre>
        <p className="mt-1 text-xs text-destructive">
          Unable to render chart. The spec is still available above.
        </p>
      </div>
    )
  }

  return (
    <VegaFigure
      spec={spec}
      className="my-2 rounded-lg border border-border/40 bg-muted/15 px-3 pb-3 pt-3"
    />
  )
}
