'use client'

import { useMemo, useState, type MouseEvent } from 'react'

import {
  ChartBar,
  CheckCircle,
  Copy,
  SpinnerGap,
} from '@phosphor-icons/react'

import type { ChartOutput } from '@/components/workspace/chat-panel/chart-output'
import { VegaFigure } from '@/components/workspace/vega-figure'
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
  const copyText = JSON.stringify(chart.spec, null, 2)
  const renderSpec = useMemo(() => {
    const next = { ...chart.spec }
    delete next.title
    return next
  }, [chart.spec])

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/15">
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <ChartBar size={12} weight="fill" className="shrink-0 text-primary/70" />
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{chart.title}</p>
          {isRunning ? (
            <SpinnerGap size={12} className="shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <ChartCopyButton text={copyText} />
        </div>
        {chart.sourceNote ? (
          <p className="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground">{chart.sourceNote}</p>
        ) : null}
      </div>

      <div className="border-t border-border/30 px-3 pb-3 pt-3">
        <VegaFigure
          spec={renderSpec}
          className="w-full [&_svg]:max-w-full"
          errorMessage="Unable to render chart. The chart spec is still available to copy."
        />
      </div>
    </div>
  )
}
