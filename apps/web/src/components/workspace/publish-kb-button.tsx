'use client'

import { useCallback, useState } from 'react'
import { ArrowsClockwise, Check, Warning, X } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PublishKbResult } from '@/app/api/instances/[slug]/publish-kb/route'

type PublishKbButtonProps = {
  slug: string
  disabled?: boolean
  disabledReason?: string
  onComplete?: (result: PublishKbResult) => void
}

type PublishState =
  | 'idle'
  | 'publishing'
  | 'published'
  | 'nothing'
  | 'conflicts'
  | 'no_remote'
  | 'error'

export function PublishKbButton({ slug, disabled, disabledReason, onComplete }: PublishKbButtonProps) {
  const [state, setState] = useState<PublishState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [files, setFiles] = useState<string[]>([])

  const handlePublish = useCallback(async () => {
    if (state === 'publishing') return

    setState('publishing')
    setMessage(null)
    setFiles([])

    try {
      const response = await fetch(`/api/instances/${slug}/publish-kb`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      const result: PublishKbResult = await response.json()

      if (result.status === 'published') {
        setState('published')
        onComplete?.(result)
        setTimeout(() => setState('idle'), 2000)
        return
      }

      if (result.status === 'nothing_to_publish') {
        setState('nothing')
        onComplete?.(result)
        setTimeout(() => setState('idle'), 2000)
        return
      }

      if (result.status === 'push_rejected') {
        setState('idle')
        setMessage(null)
        setFiles([])
        onComplete?.(result)
        return
      }

      if (result.status === 'conflicts') {
        setState('conflicts')
        setMessage(result.message || 'There are unresolved conflicts')
        setFiles(result.githubConflictFiles || result.files || [])
        onComplete?.(result)
        return
      }

      if (result.status === 'no_remote') {
        setState('no_remote')
        setMessage(result.message || 'KB remote not configured')
        onComplete?.(result)
        return
      }

      setState('error')
      setMessage(result.message || 'Publishing failed')
      onComplete?.(result)
    } catch (err) {
      setState('error')
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setMessage(msg)
      onComplete?.({ ok: false, status: 'error', message: msg })
    }
  }, [slug, state, onComplete])

  const handleDismiss = useCallback(() => {
    setState('idle')
    setMessage(null)
    setFiles([])
  }, [])

  const stateConfig = {
    idle: {
      icon: Check,
      label: 'Publish',
      className: '',
      buttonClassName: '',
      weight: 'bold' as const,
    },
    publishing: {
      icon: ArrowsClockwise,
      label: 'Publishing...',
      className: 'animate-spin',
      buttonClassName: '',
      weight: 'bold' as const,
    },
    published: {
      icon: Check,
      label: 'Published',
      className: '',
      buttonClassName: 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25',
      weight: 'bold' as const,
    },
    nothing: {
      icon: Check,
      label: 'No changes',
      className: '',
      buttonClassName: 'bg-muted text-muted-foreground hover:bg-muted/80',
      weight: 'bold' as const,
    },
    conflicts: {
      icon: Warning,
      label: 'Conflicts',
      className: 'text-amber-500',
      buttonClassName: '',
      weight: 'fill' as const,
    },
    no_remote: {
      icon: Warning,
      label: 'No remote',
      className: 'text-amber-500',
      buttonClassName: '',
      weight: 'fill' as const,
    },
    error: {
      icon: X,
      label: 'Error',
      className: 'text-red-500',
      buttonClassName: '',
      weight: 'bold' as const,
    },
  }

  const config = stateConfig[state]
  const Icon = config.icon
  const showPopover = state === 'conflicts' || state === 'no_remote' || state === 'error'

  return (
    <div className="relative">
      <Button
        size="sm"
        className={cn("h-7 gap-1.5 px-2.5 text-xs", config.buttonClassName)}
        onClick={handlePublish}
        disabled={disabled || state === 'publishing'}
        title={message || disabledReason || 'Publish changes'}
      >
        <Icon size={12} weight={config.weight} className={cn(config.className)} />
        {config.label}
      </Button>

      {showPopover && (
        <div className="absolute right-0 top-full z-50 -mt-px w-64 rounded-md border border-border bg-popover p-3 shadow-md">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {state === 'conflicts' ? (
                <>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Merge conflicts detected
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {files.length} file{files.length !== 1 ? 's' : ''} need resolution in the Review panel.
                  </p>
                </>
              ) : state === 'no_remote' ? (
                <>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    KB remote unavailable
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {message || 'Configure the KB remote before publishing'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-red-500">Publishing failed</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {message || 'Publishing failed'}
                  </p>
                </>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 shrink-0"
              aria-label="Close"
              onClick={handleDismiss}
            >
              <X size={12} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
