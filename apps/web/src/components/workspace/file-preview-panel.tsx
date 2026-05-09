'use client'

import { useCallback, useState } from 'react'
import { Check, ClipboardText, Eye, PencilSimple, X } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'

import { MarkdownPreview } from './markdown-preview'

type FilePreviewPanelProps = {
  path: string
  content: string
  isLoading?: boolean
  onClose: () => void
  onEdit: () => void
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy fallback below.
    }
  }
  if (typeof document === 'undefined') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}

export function FilePreviewPanel({
  path,
  content,
  isLoading = false,
  onClose,
  onEdit,
}: FilePreviewPanelProps) {
  const fileName = path.split('/').pop() ?? path
  const isMarkdown = path.endsWith('.md')
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!content) return
    const ok = await copyTextToClipboard(content)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }, [content])

  return (
    <div className="flex h-full min-h-0 flex-col text-card-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 pl-3 pr-2 py-2">
        <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/40 bg-foreground/[0.04] px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Eye size={11} weight="bold" />
          Quickview
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          title={path}
        >
          {fileName}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => void handleCopy()}
          disabled={!content}
          aria-label="Copy as markdown"
        >
          {copied ? (
            <Check size={12} weight="bold" />
          ) : (
            <ClipboardText size={12} weight="bold" />
          )}
          {copied ? 'Copied' : 'Copy as MD'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={onEdit}
          aria-label="Edit file"
        >
          <PencilSimple size={12} weight="bold" />
          Edit
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label="Close preview"
        >
          <X size={13} weight="bold" />
        </button>
      </div>

      <div data-testid="file-preview-scroller" className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
        {isLoading && !content ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : isMarkdown ? (
          <MarkdownPreview content={content} />
        ) : (
          <pre className="whitespace-pre-wrap break-words px-6 pb-6 pt-1 font-mono text-xs text-muted-foreground">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}
