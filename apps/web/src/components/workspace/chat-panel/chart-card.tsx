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
import { copyTextToClipboard } from '@/components/workspace/chat-panel/clipboard'

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
      {copied ? <CheckCircle size={14} weight="fill" className="text-primary" /> : <Copy size={14} />}
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
        const result = await embed(container, chart.spec as VisualizationSpec, {
          actions: false,
          ast: true,
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
    <div className="my-3 overflow-hidden rounded-xl border border-border/60 bg-card text-sm shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/40 px-4 py-2.5">
        <ChartBar size={16} weight="fill" className="shrink-0 text-primary" />
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">Chart</span>
        {isRunning || isLoading ? (
          <span className="chat-text-micro inline-flex items-center gap-1 text-muted-foreground">
            <SpinnerGap size={12} className="animate-spin" />
            {isRunning ? 'Updating' : 'Rendering'}
          </span>
        ) : null}
        <div className="ml-auto">
          <ChartCopyButton text={copyText} />
        </div>
      </div>

      <div className="border-b border-border/30 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">{chart.title}</h3>
        {chart.sourceNote ? <p className="mt-1 text-xs text-muted-foreground">{chart.sourceNote}</p> : null}
      </div>

      <div className="min-h-52 px-4 py-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <div ref={containerRef} className="min-h-44 w-full [&_svg]:max-w-full" />
      </div>
    </div>
  )
}
