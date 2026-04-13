'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SLACK_MANIFEST_JSON, SLACK_MANIFEST_YAML } from '@/lib/slack/manifest'
import type {
  SlackIntegrationGetResponse,
  SlackIntegrationMutateResponse,
  SlackIntegrationStatus,
  SlackIntegrationSummary,
  SlackIntegrationTestResponse,
} from '@/lib/slack/types'

type SlackIntegrationPanelProps = {
  slug: string
}

const SLACK_DOCS_URL = 'https://api.slack.com/apis/connections/socket'

const ERROR_MESSAGES: Record<string, string> = {
  cannot_reconnect_disabled: 'Enable the integration before requesting a reconnect.',
  forbidden: 'Only admins can manage the Slack integration.',
  invalid_app_token: 'Paste a valid Slack app token that starts with xapp-.',
  invalid_body: 'The request body was invalid.',
  invalid_bot_token: 'Paste a valid Slack bot token that starts with xoxb-.',
  invalid_json: 'The request body was invalid JSON.',
  missing_tokens: 'Both the bot token and the app token are required.',
  network_error: 'Could not reach the server.',
  service_user_conflict: 'The reserved slack-bot service user is already used by a human account.',
  slack_test_failed: 'Slack rejected the provided credentials.',
  unknown_agent: 'Choose an existing agent or keep the primary-agent fallback.',
}

function getErrorMessage(error: string | undefined): string {
  if (!error) {
    return 'Something went wrong while talking to Slack.'
  }

  return ERROR_MESSAGES[error] ?? error
}

function getStatusVariant(status: SlackIntegrationStatus): 'default' | 'secondary' | 'warning' | 'outline' {
  if (status === 'connected') {
    return 'default'
  }
  if (status === 'error') {
    return 'warning'
  }
  if (status === 'connecting') {
    return 'outline'
  }

  return 'secondary'
}

function getStatusLabel(status: SlackIntegrationStatus): string {
  if (status === 'connected') {
    return 'Connected'
  }
  if (status === 'connecting') {
    return 'Connecting'
  }
  if (status === 'error') {
    return 'Error'
  }

  return 'Disabled'
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Never'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown'
  }

  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return true
  }

  return false
}

export function SlackIntegrationPanel({ slug }: SlackIntegrationPanelProps) {
  const [agents, setAgents] = useState<SlackIntegrationGetResponse['agents']>([])
  const [integration, setIntegration] = useState<SlackIntegrationSummary | null>(null)
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [defaultAgentId, setDefaultAgentId] = useState('')
  const [busyAction, setBusyAction] = useState<'disable' | 'enable' | 'reconnect' | 'test' | null>(null)
  const [copyState, setCopyState] = useState<'json' | 'yaml' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [manifestFormat, setManifestFormat] = useState<'json' | 'yaml'>('yaml')
  const [testResult, setTestResult] = useState<SlackIntegrationTestResponse | null>(null)

  const effectiveAgentLabel = useMemo(() => {
    if (!integration?.resolvedDefaultAgentId) {
      return 'None'
    }

    return agents.find((agent) => agent.id === integration.resolvedDefaultAgentId)?.displayName ?? integration.resolvedDefaultAgentId
  }, [agents, integration?.resolvedDefaultAgentId])

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

      setAgents(data.agents)
      setIntegration(data.integration)
      setDefaultAgentId(data.integration.defaultAgentId ?? '')
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadIntegration()
  }, [loadIntegration])

  async function handleCopy(format: 'json' | 'yaml') {
    const text = format === 'yaml' ? SLACK_MANIFEST_YAML : SLACK_MANIFEST_JSON
    const copied = await copyText(text).catch(() => false)
    if (!copied) {
      return
    }

    setCopyState(format)
    window.setTimeout(() => setCopyState((current) => (current === format ? null : current)), 2000)
  }

  async function mutateIntegration(action: 'disable' | 'enable' | 'reconnect') {
    setBusyAction(action)
    setError(null)
    setTestResult(null)

    try {
      const response = await fetch(`/api/u/${slug}/slack-integration`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appToken: action === 'disable' ? undefined : appToken.trim() || undefined,
          botToken: action === 'disable' ? undefined : botToken.trim() || undefined,
          defaultAgentId: defaultAgentId || null,
          enabled: action === 'disable' ? false : true,
          reconnect: action === 'reconnect',
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (SlackIntegrationMutateResponse & { error?: string; message?: string })
        | { error?: string; message?: string }
        | null

      if (!response.ok || !data || !('integration' in data)) {
        setError(getErrorMessage(data?.error ?? data?.message))
        return
      }

      setAgents(data.agents)
      setIntegration(data.integration)
      setDefaultAgentId(data.integration.defaultAgentId ?? '')
      setBotToken('')
      setAppToken('')
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleTestConnection() {
    setBusyAction('test')
    setError(null)
    setTestResult(null)

    try {
      const response = await fetch(`/api/u/${slug}/slack-integration/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appToken: appToken.trim() || undefined,
          botToken: botToken.trim() || undefined,
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (SlackIntegrationTestResponse & { error?: string; message?: string })
        | { error?: string; message?: string }
        | null

      if (!response.ok || !data || !('ok' in data)) {
        setError(getErrorMessage(data?.error ?? data?.message))
        return
      }

      setTestResult(data)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section className="space-y-6 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium">Slack integration</h2>
            {integration ? (
              <Badge variant={getStatusVariant(integration.status)}>{getStatusLabel(integration.status)}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Configure a single admin-managed Slack bot for this Arche installation using Socket Mode.
          </p>
        </div>
        {isLoading ? <span className="text-xs text-muted-foreground">Loading...</span> : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {testResult ? (
        <div className="rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Test connection succeeded.</p>
          <p className="mt-1 text-muted-foreground">
            Team: {testResult.teamId ?? 'unknown'} | App: {testResult.appId ?? 'unknown'} | Bot user:{' '}
            {testResult.botUserId ?? 'unknown'}
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Setup</h3>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li>1. Create an internal Slack app from the manifest below.</li>
              <li>2. Enable Socket Mode.</li>
              <li>3. Install the app in your Slack workspace.</li>
              <li>4. Generate an app-level token with `connections:write`.</li>
              <li>5. Paste the bot token and app token here.</li>
              <li>6. Invite the bot to the channels where it should operate.</li>
            </ol>
            <a
              href={SLACK_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-medium text-primary hover:underline"
            >
              Open Slack Socket Mode docs
            </a>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="slack-bot-token" className="text-sm font-medium text-foreground">
                Bot token
              </label>
              <Input
                id="slack-bot-token"
                type="password"
                placeholder={integration?.hasBotToken ? 'Saved. Paste to rotate.' : 'xoxb-...'}
                value={botToken}
                onChange={(event) => setBotToken(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="slack-app-token" className="text-sm font-medium text-foreground">
                App token
              </label>
              <Input
                id="slack-app-token"
                type="password"
                placeholder={integration?.hasAppToken ? 'Saved. Paste to rotate.' : 'xapp-...'}
                value={appToken}
                onChange={(event) => setAppToken(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="slack-default-agent" className="text-sm font-medium text-foreground">
                Default agent
              </label>
              <div className="relative">
                <select
                  id="slack-default-agent"
                  value={defaultAgentId}
                  onChange={(event) => setDefaultAgentId(event.target.value)}
                  className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
                >
                  <option value="">Primary agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}{agent.isPrimary ? ' (Primary)' : ''}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Effective agent: {effectiveAgentLabel}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busyAction !== null} onClick={() => void handleTestConnection()}>
                {busyAction === 'test' ? 'Testing...' : 'Test connection'}
              </Button>
              <Button type="button" disabled={busyAction !== null} onClick={() => void mutateIntegration('enable')}>
                {busyAction === 'enable' ? 'Enabling...' : 'Enable'}
              </Button>
              <Button type="button" variant="outline" disabled={busyAction !== null} onClick={() => void mutateIntegration('disable')}>
                {busyAction === 'disable' ? 'Disabling...' : 'Disable'}
              </Button>
              <Button type="button" variant="outline" disabled={busyAction !== null} onClick={() => void mutateIntegration('reconnect')}>
                {busyAction === 'reconnect' ? 'Reconnecting...' : 'Reconnect'}
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-foreground">Slack manifest</h3>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant={manifestFormat === 'yaml' ? 'secondary' : 'outline'} onClick={() => setManifestFormat('yaml')}>
                  YAML
                </Button>
                <Button type="button" size="sm" variant={manifestFormat === 'json' ? 'secondary' : 'outline'} onClick={() => setManifestFormat('json')}>
                  JSON
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy(manifestFormat)}>
                  {copyState === manifestFormat ? 'Copied' : `Copy ${manifestFormat.toUpperCase()}`}
                </Button>
              </div>
            </div>
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted/40 p-3 text-xs text-foreground">
              {manifestFormat === 'yaml' ? SLACK_MANIFEST_YAML : SLACK_MANIFEST_JSON}
            </pre>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border/60 bg-background/40 p-4">
          <h3 className="text-sm font-medium text-foreground">Diagnostics</h3>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Team ID</p>
              <p className="mt-1 font-mono text-foreground">{integration?.slackTeamId ?? 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">App ID</p>
              <p className="mt-1 font-mono text-foreground">{integration?.slackAppId ?? 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Bot User ID</p>
              <p className="mt-1 font-mono text-foreground">{integration?.slackBotUserId ?? 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Config Version</p>
              <p className="mt-1 font-mono text-foreground">{integration?.version ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Connection</p>
              <p className="mt-1 text-foreground">{formatTimestamp(integration?.lastSocketConnectedAt ?? null)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Event</p>
              <p className="mt-1 text-foreground">{formatTimestamp(integration?.lastEventAt ?? null)}</p>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Error</p>
            <p className="mt-1 rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground">
              {integration?.lastError ?? 'None'}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Saved Tokens</p>
            <p className="mt-1 text-sm text-foreground">
              Bot: {integration?.hasBotToken ? 'Saved' : 'Missing'} | App: {integration?.hasAppToken ? 'Saved' : 'Missing'}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
