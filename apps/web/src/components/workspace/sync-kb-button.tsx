'use client'

import { useState, useCallback } from 'react'
import { ArrowsClockwise, Check, Warning, X } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SyncKbResult } from '@/app/api/instances/[slug]/sync-kb/route'

type SyncKbButtonProps = {
  slug: string
  disabled?: boolean
}

type SyncState = 'idle' | 'syncing' | 'synced' | 'conflicts' | 'error'

export function SyncKbButton({ slug, disabled }: SyncKbButtonProps) {
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
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [slug])

  const handleDismiss = useCallback(() => {
    setState('idle')
    setConflicts([])
    setError(null)
  }, [])

  const stateConfig = {
    idle: {
      icon: ArrowsClockwise,
      label: 'Sync KB',
      className: '',
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

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={handleSync}
        disabled={disabled || state === 'syncing'}
        title={error || (conflicts.length > 0 ? `${conflicts.length} files with conflicts` : 'Sync Knowledge Base')}
      >
        <Icon
          size={14}
          weight={config.weight}
          className={cn(config.className)}
        />
        <span className="hidden sm:inline">{config.label}</span>
      </Button>

      {/* Popover para mostrar conflictos o errores */}
      {(state === 'conflicts' || state === 'error') && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover p-3 shadow-md">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              {state === 'conflicts' ? (
                <>
                  <p className="text-sm font-medium text-amber-500">
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
