'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'

import type { EmbedOptions, VisualizationSpec } from 'vega-embed'

import {
  buildVegaConfig,
  resolveVisualizationTheme,
} from '@/components/workspace/chat-panel/visualization-theme'
import { buildWorkspaceLoader } from '@/components/workspace/vega-workspace-loader'
import {
  describeRenderError,
  escapeTooltipValue,
  isUnsafeChartLinkTarget,
  withRenderTimeout,
} from '@/lib/vega/embed-safety'
import type { SanitizedChart } from '@/lib/vega/sanitize-spec'

const RENDER_TIMEOUT_MS = 15_000
// SVG keeps text selectable and styleable, but one DOM node per mark stops scaling
// somewhere in the low tens of thousands. Canvas takes over past this point.
const CANVAS_ROW_THRESHOLD = 5_000

function blockUnsafeLinkNavigation(event: MouseEvent<HTMLDivElement>) {
  if (!isUnsafeChartLinkTarget(event.target)) return

  event.preventDefault()
  event.stopPropagation()
  console.warn('Blocked navigation to an unsupported URL scheme in a chart link.')
}

type RenderError = {
  summary: string
  detail: string | null
}

type VegaFigureProps = {
  /** The sanitized chart to render: spec, inline row cost and any warnings. */
  chart: SanitizedChart
  className?: string
  errorMessage?: string
  /** Workspace whose files relative `data.url` values resolve against. */
  workspaceSlug?: string
}

export function VegaFigure({ chart, className, errorMessage, workspaceSlug }: VegaFigureProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<RenderError | null>(null)
  const { spec, warnings, inlineRows } = chart

  useEffect(() => {
    const container = containerRef.current
    let cancelled = false
    let finalize: (() => void) | undefined

    async function renderChart() {
      if (!container) return

      setError(null)
      container.innerHTML = ''

      try {
        const { default: embed, vega } = await import('vega-embed')
        const theme = resolveVisualizationTheme()

        const options: EmbedOptions = {
          // Export and view-source are read-only and useful. The Vega editor action is
          // deliberately off: it POSTs the spec and its inline data to an external site.
          actions: { compiled: true, editor: false, export: true, source: true },
          ast: true,
          config: buildVegaConfig(theme),
          // vega-embed scopes its stylesheet under `.vega-embed`; without it the actions
          // menu renders unstyled.
          defaultStyle: true,
          hover: true,
          mode: 'vega-lite',
          renderer: inlineRows > CANVAS_ROW_THRESHOLD ? 'canvas' : 'svg',
          tooltip: {
            sanitize: escapeTooltipValue,
            theme: theme.isDark ? 'dark' : 'light',
          },
        }
        if (workspaceSlug) options.loader = buildWorkspaceLoader(vega, workspaceSlug)

        const result = await withRenderTimeout(
          embed(container, spec as VisualizationSpec, options),
          RENDER_TIMEOUT_MS,
        )

        if (cancelled) {
          result.finalize()
          return
        }

        finalize = result.finalize
      } catch (renderError) {
        if (!cancelled) {
          console.error('Failed to render chart:', renderError)
          setError({
            summary: errorMessage ?? 'Unable to render chart.',
            detail: describeRenderError(renderError),
          })
        }
      }
    }

    renderChart()

    return () => {
      cancelled = true
      finalize?.()
      if (container) container.innerHTML = ''
    }
  }, [spec, inlineRows, errorMessage, workspaceSlug])

  return (
    <div className={className}>
      {error ? (
        <div className="mb-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          <p>{error.summary}</p>
          {error.detail ? (
            <p className="mt-1 break-words font-mono text-[11px] opacity-80">{error.detail}</p>
          ) : null}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="mb-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <div
        ref={containerRef}
        onClickCapture={blockUnsafeLinkNavigation}
        className="min-h-44 w-full [&_svg]:max-w-full"
      />
    </div>
  )
}
