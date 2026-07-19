'use client'

import { useEffect, useRef, useState } from 'react'

import type { VisualizationSpec } from 'vega-embed'

import type { ChartSpec } from '@/components/workspace/chat-panel/chart-output'
import {
  buildVegaConfig,
  resolveVisualizationTheme,
} from '@/components/workspace/chat-panel/visualization-theme'

type VegaFigureProps = {
  spec: ChartSpec
  className?: string
  errorMessage?: string
}

export function VegaFigure({ spec, className, errorMessage }: VegaFigureProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    let cancelled = false
    let finalize: (() => void) | undefined

    async function renderChart() {
      if (!container) return

      setError(null)
      container.innerHTML = ''

      try {
        const { default: embed } = await import('vega-embed')
        const theme = resolveVisualizationTheme()
        const result = await embed(container, spec as VisualizationSpec, {
          actions: false,
          ast: true,
          config: buildVegaConfig(theme),
          defaultStyle: false,
          mode: 'vega-lite',
          renderer: 'svg',
          tooltip: false,
        })

        if (cancelled) {
          result.finalize()
          return
        }

        finalize = result.finalize
      } catch (renderError) {
        if (!cancelled) {
          console.error('Failed to render chart:', renderError)
          setError(errorMessage ?? 'Unable to render chart.')
        }
      }
    }

    renderChart()

    return () => {
      cancelled = true
      finalize?.()
      if (container) container.innerHTML = ''
    }
  }, [spec, errorMessage])

  return (
    <div className={className}>
      {error ? (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          <span>{error}</span>
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-44 w-full [&_svg]:max-w-full" />
    </div>
  )
}
