'use client'

import { useMemo } from 'react'

import { sanitizeVegaLiteSpec } from '@/lib/vega/sanitize-spec'
import { VegaFigure } from '@/components/workspace/vega-figure'
import { useWorkspaceSlug } from '@/components/workspace/vega-workspace-loader'

type MarkdownChartProps = {
  source: string
}

// While an assistant message streams, the fence holds a prefix of the JSON. That is not
// an error yet, so the "unable to render" note is withheld for a source that opens like
// JSON but has not closed. Anything that never looked like JSON is reported immediately.
function looksTruncated(source: string): boolean {
  const opensAsJson = source.startsWith('{') || source.startsWith('[')
  const closesAsJson = source.endsWith('}') || source.endsWith(']')
  return opensAsJson && !closesAsJson
}

export function MarkdownChart({ source }: MarkdownChartProps) {
  const trimmed = source.trim()
  const workspaceSlug = useWorkspaceSlug()

  const sanitized = useMemo(() => {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
    return sanitizeVegaLiteSpec(parsed)
  }, [trimmed])

  if (!sanitized) {
    return (
      <div className="my-2">
        <pre className="overflow-x-auto rounded-lg border border-border/40 bg-muted/15 px-3 pb-3 pt-3">
          <code className="text-xs">{trimmed}</code>
        </pre>
        {looksTruncated(trimmed) ? null : (
          <p className="mt-1 text-xs text-destructive">
            Unable to render chart. The spec is still available above.
          </p>
        )}
      </div>
    )
  }

  return (
    <VegaFigure
      chart={sanitized}
      workspaceSlug={workspaceSlug}
      className="my-2 rounded-lg border border-border/40 bg-muted/15 px-3 pb-3 pt-3"
    />
  )
}
