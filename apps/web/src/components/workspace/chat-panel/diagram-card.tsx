'use client'

import { useEffect, useId, useState, type MouseEvent } from 'react'

import {
  CheckCircle,
  Copy,
  SpinnerGap,
  TreeStructure,
  WarningCircle,
} from '@phosphor-icons/react'

import {
  hasBlockedMermaidSyntax,
  type DiagramOutput,
} from '@/components/workspace/chat-panel/diagram-output'
import {
  buildMermaidThemeVariables,
  resolveVisualizationTheme,
} from '@/components/workspace/chat-panel/visualization-theme'
import { copyTextToClipboard } from '@/lib/clipboard'

type DiagramCardProps = {
  diagram: DiagramOutput
  isRunning: boolean
}

type MermaidApi = typeof import('mermaid')['default']

let mermaidPromise: Promise<MermaidApi> | undefined

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then(({ default: mermaid }) => {
        const theme = resolveVisualizationTheme()
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          // Root-level htmlLabels (v11+). The deprecated flowchart.htmlLabels is
          // ignored, so labels would otherwise render as HTML in <foreignObject>
          // and get stripped by DOMPurify's SVG profile, leaving empty nodes.
          htmlLabels: false,
          flowchart: { useMaxWidth: true },
          theme: 'base',
          themeVariables: buildMermaidThemeVariables(theme),
        })

        return mermaid
      })
      .catch((error: unknown) => {
        mermaidPromise = undefined
        throw error
      })
  }

  return mermaidPromise
}

function DiagramCopyButton({ text }: { text: string }) {
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
      title="Copy diagram source"
      aria-label="Copy diagram source"
    >
      {copied ? <CheckCircle size={12} weight="fill" className="text-primary" /> : <Copy size={12} />}
    </button>
  )
}

export function DiagramCard({ diagram, isRunning }: DiagramCardProps) {
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function renderDiagram() {
      setSvg(null)
      setError(null)
      setIsLoading(true)

      if (hasBlockedMermaidSyntax(diagram.source)) {
        setError('Unable to render diagram because the Mermaid source uses unsupported syntax.')
        setIsLoading(false)
        return
      }

      try {
        const [mermaid, { default: DOMPurify }] = await Promise.all([
          loadMermaid(),
          import('dompurify'),
        ])

        const result = await mermaid.render(`arche-diagram-${renderId}`, diagram.source)
        const cleanSvg = DOMPurify.sanitize(result.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        })

        if (!cancelled) {
          setSvg(cleanSvg)
          setIsLoading(false)
        }
      } catch (renderError) {
        if (!cancelled) {
          console.error('Failed to render diagram:', renderError)
          setError('Unable to render diagram. The Mermaid source is still available to copy.')
          setIsLoading(false)
        }
      }
    }

    renderDiagram()

    return () => {
      cancelled = true
    }
  }, [diagram.source, renderId])

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/15">
      <div className="flex items-center gap-2 px-3 py-2">
        <TreeStructure size={12} weight="fill" className="shrink-0 text-primary/70" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{diagram.title}</p>
        {isRunning || isLoading ? (
          <SpinnerGap size={12} className="shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <DiagramCopyButton text={diagram.source} />
      </div>

      <div className="border-t border-border/30 px-3 pb-3 pt-3">
        {error ? (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
            <WarningCircle size={12} weight="fill" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        {svg ? (
          <div
            className="flex min-h-44 w-full justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
      </div>
    </div>
  )
}
