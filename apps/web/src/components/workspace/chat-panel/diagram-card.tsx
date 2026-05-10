'use client'

import { useEffect, useId, useState, type MouseEvent } from 'react'

import {
  CheckCircle,
  Copy,
  SpinnerGap,
  TreeStructure,
  WarningCircle,
} from '@phosphor-icons/react'

import { copyTextToClipboard } from '@/components/workspace/chat-panel/clipboard'
import {
  hasBlockedMermaidSyntax,
  type DiagramOutput,
} from '@/components/workspace/chat-panel/diagram-output'

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
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          flowchart: { htmlLabels: false },
          theme: 'default',
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
      {copied ? <CheckCircle size={14} weight="fill" className="text-primary" /> : <Copy size={14} />}
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
    <div className="my-3 overflow-hidden rounded-xl border border-border/60 bg-card text-sm shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/40 px-4 py-2.5">
        <TreeStructure size={16} weight="fill" className="shrink-0 text-primary" />
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">Diagram</span>
        {isRunning || isLoading ? (
          <span className="chat-text-micro inline-flex items-center gap-1 text-muted-foreground">
            <SpinnerGap size={12} className="animate-spin" />
            {isRunning ? 'Updating' : 'Rendering'}
          </span>
        ) : null}
        <div className="ml-auto">
          <DiagramCopyButton text={diagram.source} />
        </div>
      </div>

      <div className="border-b border-border/30 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">{diagram.title}</h3>
      </div>

      <div className="min-h-52 px-4 py-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
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
