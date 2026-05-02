'use client'

import { useState, useCallback } from 'react'
import { ArrowsClockwise, Check, Warning, X } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SyncKbResult } from '@/app/api/instances/[slug]/sync-kb/route'

type SyncKbButtonProps = {
  slug: string
  disabled?: boolean
  onComplete?: (status: SyncKbResult['status']) => void
  variant?: 'default' | 'muted'
  renderAs?: 'icon' | 'row'
}

type SyncState = 'idle' | 'syncing' | 'synced' | 'conflicts' | 'error'

export function SyncKbButton({ slug, disabled, onComplete, variant = 'default', renderAs = 'icon' }: SyncKbButtonProps) {
  const [state, setState] = useState<SyncState>('idle')
  const [conflicts, setConflicts] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleSync = useCallback(async () => {
    setState('syncing')
    setError(null)
    setConflicts([])

    try {
      const response = await fetch(`/api/instances/${slug}/sync-kb`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      const result: SyncKbResult = await response.json()

      if (result.status === 'synced') {
        setState('synced')
        // Reset to idle after showing success
        setTimeout(() => setState('idle'), 2000)
      } else if (result.status === 'conflicts') {
        setState('conflicts')
        setConflicts(result.conflicts || [])
      } else {
        setState('error')
        setError(result.message || 'Sync failed')
      }
      onComplete?.(result.status)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Unknown error')
      onComplete?.('error')
    }
  }, [slug, onComplete])

  const handleDismiss = useCallback(() => {
    setState('idle')
    setConflicts([])
    setError(null)
  }, [])

  const stateConfig = {
    idle: {
      icon: ArrowsClockwise,
      label: 'Sync KB',
      className: variant === 'muted' ? 'text-muted-foreground' : '',
      weight: 'bold' as const,
    },
    syncing: {
      icon: ArrowsClockwise,
      label: 'Syncing...',
      className: 'animate-spin',
      weight: 'bold' as const,
    },
    synced: {
      icon: Check,
      label: 'Synced',
      className: 'text-emerald-500',
      weight: 'bold' as const,
    },
    conflicts: {
      icon: Warning,
      label: 'Conflicts',
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
  const tooltipLabel = error || (conflicts.length > 0 ? `${conflicts.length} files with conflicts` : 'Sync knowledge base')

  const rowLabel =
    state === 'syncing'
      ? 'Syncing knowledge base…'
      : state === 'synced'
        ? 'Knowledge base synced'
        : state === 'conflicts'
          ? `Conflicts detected${conflicts.length ? ` (${conflicts.length})` : ''}`
          : state === 'error'
            ? 'Sync failed'
            : 'Sync knowledge base'

  return (
    <div className="relative">
      {renderAs === 'row' ? (
        <button
          type="button"
          onClick={handleSync}
          disabled={disabled || state === 'syncing'}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
            'text-foreground hover:bg-foreground/5',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <Icon
            size={15}
            weight={config.weight}
            className={cn('shrink-0 text-muted-foreground', config.className)}
          />
          <span className="min-w-0 truncate">{rowLabel}</span>
        </button>
      ) : (
        <TooltipProvider delayDuration={2000}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={cn("h-7 w-7", variant === 'muted' && "text-muted-foreground hover:text-foreground")}
                onClick={handleSync}
                disabled={disabled || state === 'syncing'}
              >
                <Icon
                  size={14}
                  weight={config.weight}
                  className={cn(config.className)}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Popover para mostrar conflictos o errores (solo en modo icon) */}
      {renderAs === 'icon' && (state === 'conflicts' || state === 'error') && (
        <div className="absolute right-0 top-full z-50 -mt-px w-64 rounded-md border border-border bg-popover p-3 shadow-md">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {state === 'conflicts' ? (
                <>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Merge conflicts detected
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Resolve these files in the editor:
                  </p>
                  <ul className="mt-2 max-h-32 overflow-y-auto text-xs">
                    {conflicts.map((file) => (
                      <li
                        key={file}
                        className="truncate font-mono text-muted-foreground"
                        title={file}
                      >
                        {file}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-red-500">Sync failed</p>
                  <p className="mt-1 text-xs text-muted-foreground">{error}</p>
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
