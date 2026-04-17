'use client'

import { useCallback, useEffect, useState } from 'react'

import { SettingsInfoBox } from '@/components/settings/settings-info-box'
import { SettingsSection } from '@/components/settings/settings-section'
import { Button } from '@/components/ui/button'
import type { SlackIntegrationGetResponse } from '@/lib/slack/types'

type SlackIntegrationDangerZoneProps = {
  slug: string
  refreshVersion?: number
  onMutated?: () => void
}

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Only admins can manage the Slack integration.',
  network_error: 'Could not reach the server.',
}

export function SlackIntegrationDangerZone({
  slug,
  refreshVersion,
  onMutated,
}: SlackIntegrationDangerZoneProps) {
  const [enabled, setEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isDisabling, setIsDisabling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadIntegration = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/slack-integration`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | (SlackIntegrationGetResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('integration' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setEnabled(data.integration.enabled)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadIntegration()
  }, [loadIntegration, refreshVersion])

  async function handleDisable() {
    setIsDisabling(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/slack-integration`, {
        method: 'DELETE',
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setError(getErrorMessage(data?.error))
        return
      }

      setEnabled(false)
      onMutated?.()
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setIsDisabling(false)
    }
  }

  return (
    <SettingsSection
      title="Danger zone"
      description="Disabling the integration stops the Socket Mode connection and clears stored tokens."
      titleClassName="text-destructive"
      action={
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isLoading || isDisabling || !enabled}
          onClick={() => void handleDisable()}
        >
          {isDisabling ? 'Disabling...' : enabled ? 'Disable integration' : 'Integration disabled'}
        </Button>
      }
    >
      {error ? <SettingsInfoBox tone="error">{error}</SettingsInfoBox> : null}
    </SettingsSection>
  )
}

function getErrorMessage(error: string | undefined): string {
  if (!error) {
    return 'Something went wrong while talking to Slack.'
  }

  return ERROR_MESSAGES[error] ?? error
}
