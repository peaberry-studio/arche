'use client'

import { useCallback, useEffect, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { SettingsInfoBox } from '@/components/settings/settings-info-box'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  GoogleWorkspaceIntegrationGetResponse,
  GoogleWorkspaceIntegrationMutateResponse,
} from '@/lib/google-workspace/types'

type GoogleWorkspaceIntegrationPanelProps = {
  slug: string
  redirectUri: string
}

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Only admins can manage the Google Workspace integration.',
  invalid_body: 'The request body was invalid.',
  invalid_json: 'The request body was invalid JSON.',
  missing_client_id: 'Client ID is required.',
  missing_client_secret: 'Client secret is required when saving for the first time.',
  network_error: 'Could not reach the server.',
}

function getErrorMessage(error: string | undefined): string {
  if (!error) return 'Something went wrong while saving the configuration.'
  return ERROR_MESSAGES[error] ?? error
}

export function GoogleWorkspaceIntegrationPanel({ slug, redirectUri }: GoogleWorkspaceIntegrationPanelProps) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [integration, setIntegration] = useState<GoogleWorkspaceIntegrationGetResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<'save' | 'clear' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const loadIntegration = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/google-workspace-integration`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | (GoogleWorkspaceIntegrationGetResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('configured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setClientId(data.clientId ?? '')
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadIntegration()
  }, [loadIntegration])

  async function handleSave() {
    setBusyAction('save')
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/api/u/${slug}/google-workspace-integration`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim() || undefined,
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (GoogleWorkspaceIntegrationMutateResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('configured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setClientId(data.clientId ?? '')
      setClientSecret('')
      setSuccess(true)
      window.setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleClear() {
    setBusyAction('clear')
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/api/u/${slug}/google-workspace-integration`, {
        method: 'DELETE',
      })
      const data = (await response.json().catch(() => null)) as
        | (GoogleWorkspaceIntegrationMutateResponse & { error?: string })
        | { error?: string }
        | null

      if (!response.ok || !data || !('configured' in data)) {
        setError(getErrorMessage(data?.error))
        return
      }

      setIntegration(data)
      setClientId('')
      setClientSecret('')
      setSuccess(true)
      window.setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  const loadingIndicator = isLoading ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <SpinnerGap size={14} className="animate-spin" />
      Loading…
    </span>
  ) : null

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">Google Workspace integration</h2>
          {loadingIndicator}
        </div>
        <p className="text-sm text-muted-foreground">
          Configure the OAuth client used by all Google Workspace connectors (Gmail, Drive, Calendar, Chat, People).
        </p>
      </div>

      {error ? <SettingsInfoBox tone="error">{error}</SettingsInfoBox> : null}
      {success ? <SettingsInfoBox tone="success">Configuration saved.</SettingsInfoBox> : null}

        <div className="space-y-6 pt-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Setup instructions</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Open the{' '}
              <a
                href="https://developers.google.com/workspace/guides/configure-mcp-servers"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Google Workspace MCP setup guide
              </a>{' '}
              and follow the instructions.
            </li>
            <li>
              Enable the required Workspace APIs in the{' '}
              <a
                href="https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com%2Cdrive.googleapis.com%2Ccalendar-json.googleapis.com%2Cchat.googleapis.com%2Cpeople.googleapis.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Google Cloud Console
              </a>
              .
            </li>
            <li>
              Enable the MCP services in the{' '}
              <a
                href="https://console.cloud.google.com/flows/enableapi?apiid=gmailmcp.googleapis.com%2Cdrivemcp.googleapis.com%2Ccalendarmcp.googleapis.com%2Cchatmcp.googleapis.com%2Cpeople.googleapis.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Google Cloud Console
              </a>
              .
            </li>
            <li>
              Set up the{' '}
              <a
                href="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Chat app
              </a>{' '}
              if you plan to use Google Chat.
            </li>
            <li>
              Configure{' '}
              <a
                href="https://console.cloud.google.com/auth/branding"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                OAuth consent screen branding
              </a>
              ,{' '}
              <a
                href="https://console.cloud.google.com/auth/audience"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                audience
              </a>
              , and{' '}
              <a
                href="https://console.cloud.google.com/auth/scopes"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                scopes / data access
              </a>
              .
            </li>
            <li>
              Create a{' '}
              <a
                href="https://console.cloud.google.com//apis/credentials/oauthclient"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Web application OAuth client
              </a>{' '}
              and add the redirect URI below.
            </li>
            <li>Paste the Client ID and Client Secret here and save.</li>
          </ol>
        </div>

        <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Required redirect URI</p>
          <p className="mt-1 break-all font-mono text-xs">
            {redirectUri}
          </p>
          <p className="mt-2">
            The OAuth client must be configured as a <strong>Web application</strong> type and must include this redirect URI.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="google-client-id" className="text-sm font-medium text-foreground">
              OAuth Client ID
            </label>
            <Input
              id="google-client-id"
              type="text"
              placeholder="Your Google OAuth Client ID"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={busyAction !== null}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="google-client-secret" className="text-sm font-medium text-foreground">
              OAuth Client Secret
            </label>
            <Input
              id="google-client-secret"
              type="password"
              placeholder={integration?.hasClientSecret ? 'Saved. Leave blank to keep existing.' : 'Your Google OAuth Client Secret'}
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              disabled={busyAction !== null}
            />
            {integration?.hasClientSecret ? (
              <p className="text-xs text-muted-foreground">Leave blank to preserve the existing saved secret.</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleSave()}
            >
              {busyAction === 'save' ? 'Saving...' : 'Save'}
            </Button>
            {integration?.configured ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busyAction !== null}
                onClick={() => void handleClear()}
              >
                {busyAction === 'clear' ? 'Clearing...' : 'Clear credentials'}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
