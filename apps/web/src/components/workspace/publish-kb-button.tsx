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
  onComplete?: () => void
}

type PublishState =
  | 'idle'
  | 'publishing'
  | 'published'
  | 'nothing'
  | 'push_rejected'
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
        onComplete?.()
        setTimeout(() => setState('idle'), 2000)
        return
      }

      if (result.status === 'nothing_to_publish') {
        setState('nothing')
        onComplete?.()
        setTimeout(() => setState('idle'), 2000)
        return
      }

      if (result.status === 'push_rejected') {
        setState('push_rejected')
        setMessage(result.message || 'Sync the KB before publishing')
        setFiles(result.files || [])
        onComplete?.()
        return
      }

      if (result.status === 'conflicts') {
        setState('conflicts')
        setMessage(result.message || 'There are unresolved conflicts')
        setFiles(result.files || [])
        onComplete?.()
        return
      }

      if (result.status === 'no_remote') {
        setState('no_remote')
        setMessage(result.message || 'KB remote not configured')
        onComplete?.()
        return
      }

      setState('error')
      setMessage(result.message || 'Publishing failed')
      onComplete?.()
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Unknown error')
      onComplete?.()
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
      weight: 'bold' as const,
    },
    publishing: {
      icon: ArrowsClockwise,
      label: 'Publishing...',
      className: 'animate-spin',
      weight: 'bold' as const,
    },
    published: {
      icon: Check,
      label: 'Published',
      className: 'text-emerald-500',
      weight: 'bold' as const,
    },
    nothing: {
      icon: Check,
      label: 'No changes',
      className: 'text-muted-foreground',
      weight: 'bold' as const,
    },
    push_rejected: {
      icon: Warning,
      label: 'Sync required',
      className: 'text-amber-500',
      weight: 'fill' as const,
    },
    conflicts: {
      icon: Warning,
      label: 'Conflicts',
      className: 'text-amber-500',
      weight: 'fill' as const,
    },
    no_remote: {
      icon: Warning,
      label: 'No remote',
      className: 'text-amber-500',
      weight: 'fill' as const,
    },
    error: {
      icon: X,
      label: 'Error',
      className: 'text-red-500',
      weight: 'bold' as const,
    },
  }

  const config = stateConfig[state]
  const Icon = config.icon
  const showPopover = state === 'push_rejected' || state === 'conflicts' || state === 'no_remote' || state === 'error'

  return (
    <div className="relative">
      <Button
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs"
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
              {state === 'push_rejected' ? (
                <>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    KB sync required
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {message || 'Sync before publishing'}
                  </p>
                  {files.length > 0 ? (
                    <ul className="mt-2 max-h-32 overflow-y-auto text-xs">
                      {files.map((file) => (
                        <li
                          key={file}
                          className="truncate font-mono text-muted-foreground"
                          title={file}
                        >
                          {file}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : state === 'conflicts' ? (
                <>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Pending conflicts
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {message || 'Resolve conflicts before publishing'}
                  </p>
                  {files.length > 0 ? (
                    <ul className="mt-2 max-h-32 overflow-y-auto text-xs">
                      {files.map((file) => (
                        <li
                          key={file}
                          className="truncate font-mono text-muted-foreground"
                          title={file}
                        >
                          {file}
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
