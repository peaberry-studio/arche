'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'

import {
  ChartBar,
  CheckCircle,
  Copy,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react'
import type { VisualizationSpec } from 'vega-embed'

import type { ChartOutput } from '@/components/workspace/chat-panel/chart-output'
import {
  buildVegaConfig,
  resolveVisualizationTheme,
} from '@/components/workspace/chat-panel/visualization-theme'
import { copyTextToClipboard } from '@/lib/clipboard'

type ChartCardProps = {
  chart: ChartOutput
  isRunning: boolean
}

function ChartCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(event: MouseEvent) {
    event.stopPropagation()
    const ok = await copyTextToClipboard(text)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Copy chart spec"
      aria-label="Copy chart spec"
    >
      {copied ? <CheckCircle size={12} weight="fill" className="text-primary" /> : <Copy size={12} />}
    </button>
  )
}

export function ChartCard({ chart, isRunning }: ChartCardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const copyText = JSON.stringify(chart.spec, null, 2)

  useEffect(() => {
    const container = containerRef.current
    let cancelled = false
    let finalize: (() => void) | undefined

    async function renderChart() {
      if (!container) return

      setError(null)
      setIsLoading(true)
      container.innerHTML = ''

      try {
        const { default: embed } = await import('vega-embed')
        const theme = resolveVisualizationTheme()
        // The wrapper title is already shown in the card header, so we drop spec.title
        // to avoid duplicating it inside the SVG.
        const renderSpec = { ...chart.spec }
        delete renderSpec.title
        const result = await embed(container, renderSpec as VisualizationSpec, {
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
        setIsLoading(false)
      } catch (renderError) {
        if (!cancelled) {
          console.error('Failed to render chart:', renderError)
          setError('Unable to render chart. The chart spec is still available to copy.')
          setIsLoading(false)
        }
      }
    }

    renderChart()

    return () => {
      cancelled = true
      finalize?.()
      if (container) container.innerHTML = ''
    }
  }, [chart.spec])

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/15">
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <ChartBar size={12} weight="fill" className="shrink-0 text-primary/70" />
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{chart.title}</p>
          {isRunning || isLoading ? (
            <SpinnerGap size={12} className="shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <ChartCopyButton text={copyText} />
        </div>
        {chart.sourceNote ? (
          <p className="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground">{chart.sourceNote}</p>
        ) : null}
      </div>

      <div className="border-t border-border/30 px-3 pb-3 pt-3">
        {error ? (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
            <WarningCircle size={12} weight="fill" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <div ref={containerRef} className="min-h-44 w-full [&_svg]:max-w-full" />
      </div>
    </div>
  )
}
