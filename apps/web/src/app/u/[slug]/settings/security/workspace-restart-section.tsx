'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'

type WorkspaceRestartSectionProps = {
  showHeader?: boolean
  slug: string
}

function getRestartErrorMessage(error: string): string {
  if (error === 'setup_required') {
    return 'Workspace setup is incomplete.'
  }
  if (error === 'unauthorized' || error === 'forbidden') {
    return 'You are not allowed to restart this workspace.'
  }
  if (error === 'network_error') {
    return 'Network error while requesting the restart.'
  }

  return 'Unable to restart the workspace.'
}

export function WorkspaceRestartSection({ slug, showHeader = true }: WorkspaceRestartSectionProps) {
  const [isRestarting, setIsRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)

  async function handleRestart() {
    setIsRestarting(true)
    setRestartError(null)

    try {
      const response = await fetch(`/api/instances/${slug}/restart`, {
        method: 'POST',
        cache: 'no-store',
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setRestartError(data.error ?? 'restart_failed')
        setIsRestarting(false)
        return
      }

      window.location.reload()
    } catch {
      setRestartError('network_error')
      setIsRestarting(false)
    }
  }

  return (
    <div className="space-y-4">
      {showHeader ? (
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Workspace</h2>
          <p className="text-sm text-muted-foreground">
            Force a full workspace restart to rebuild the OpenCode runtime with the latest
            generated configuration.
          </p>
        </div>
      ) : null}

      {restartError ? (
        <p className="text-sm text-destructive">
          Restart failed: {getRestartErrorMessage(restartError)}
        </p>
      ) : null}

      <Button type="button" variant="outline" onClick={handleRestart} disabled={isRestarting}>
        {isRestarting ? 'Restarting workspace...' : 'Restart workspace'}
      </Button>
    </div>
  )
}
