'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CaretDown, Check, CheckCircle, Copy, Hash, Lock, SpinnerGap, XCircle } from '@phosphor-icons/react'

import { SettingsInfoBox } from '@/components/settings/settings-info-box'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { copyTextToClipboard } from '@/lib/clipboard'
import { SLACK_MANIFEST_JSON, SLACK_MANIFEST_YAML } from '@/lib/slack/manifest'
import type {
  SlackIntegrationGetResponse,
  SlackIntegrationMutateResponse,
  SlackNotificationChannel,
  SlackIntegrationStatus,
  SlackIntegrationSummary,
  SlackIntegrationTestResponse,
} from '@/lib/slack/types'
import { cn } from '@/lib/utils'

type SlackIntegrationPanelProps = {
  slug: string
  collapsible?: boolean
  showDangerZone?: boolean
  refreshVersion?: number
  onMutated?: () => void
}

const SLACK_DOCS_URL = 'https://api.slack.com/apis/connections/socket'

const ERROR_MESSAGES: Record<string, string> = {
  cannot_reconnect_disabled: 'Enable the integration before requesting a reconnect.',
  forbidden: 'Only admins can manage the Slack integration.',
  invalid_auth: 'Slack rejected one of the provided tokens.',
  invalid_app_token: 'Paste a valid Slack app token that starts with xapp-.',
  invalid_body: 'The request body was invalid.',
  invalid_bot_token: 'Paste a valid Slack bot token that starts with xoxb-.',
  invalid_json: 'The request body was invalid JSON.',
  missing_tokens: 'Both the bot token and the app token are required.',
  network_error: 'Could not reach the server.',
  not_allowed_token_type: 'Use an app token that starts with xapp- and a bot token that starts with xoxb-.',
  service_user_conflict: 'The reserved slack-bot service user is already used by a human account.',
  slack_app_mismatch: 'The bot token and app token belong to different Slack apps.',
  slack_bot_id_missing: 'Slack did not return a bot identity for this bot token.',
  slack_test_failed: 'Slack rejected the provided credentials.',
  unknown_agent: 'Choose an existing agent or keep the primary-agent fallback.',
}

function getErrorMessage(error: string | undefined): string {
  if (!error) {
    return 'Something went wrong while talking to Slack.'
  }

  return ERROR_MESSAGES[error] ?? error
}

function getApiErrorMessage(error: string | undefined, message: string | undefined): string {
  return getErrorMessage(message ?? error)
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

export function SlackIntegrationPanel({
  slug,
  collapsible = true,
  showDangerZone = true,
  refreshVersion,
  onMutated,
}: SlackIntegrationPanelProps) {
  const [agents, setAgents] = useState<SlackIntegrationGetResponse['agents']>([])
  const [integration, setIntegration] = useState<SlackIntegrationSummary | null>(null)
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [defaultAgentId, setDefaultAgentId] = useState('')
  const [busyAction, setBusyAction] = useState<'disable' | 'enable' | 'reconnect' | 'test' | null>(null)
  const [copyState, setCopyState] = useState<'json' | 'yaml' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(!collapsible)
  const [isLoading, setIsLoading] = useState(true)
  const [manifestFormat, setManifestFormat] = useState<'json' | 'yaml'>('yaml')
  const [notificationChannels, setNotificationChannels] = useState<SlackNotificationChannel[]>([])
  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false)
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

  const loadNotificationChannels = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/slack-integration/channels`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as { channels?: SlackNotificationChannel[]; error?: string } | null
      if (!response.ok || !data) {
        setError(getErrorMessage(data?.error))
        return
      }

      setNotificationChannels(data.channels ?? [])
    } catch {
      setError(getErrorMessage('network_error'))
    }
  }, [slug])

  useEffect(() => {
    void loadIntegration()
  }, [loadIntegration, refreshVersion])

  useEffect(() => {
    if (integration?.enabled) {
      void loadNotificationChannels()
      return
    }

    setNotificationChannels([])
  }, [integration?.enabled, loadNotificationChannels])

  const refreshSlackChannels = useCallback(async () => {
    setIsRefreshingChannels(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/slack-integration/channels`, {
        method: 'POST',
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(getErrorMessage(data?.error))
        return
      }

      await loadNotificationChannels()
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setIsRefreshingChannels(false)
    }
  }, [loadNotificationChannels, slug])

  const setChannelEnabled = useCallback(async (id: string, enabled: boolean) => {
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/slack-integration/channels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, id }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(getErrorMessage(data?.error))
        return
      }

      await loadNotificationChannels()
    } catch {
      setError(getErrorMessage('network_error'))
    }
  }, [loadNotificationChannels, slug])

  async function handleCopy(format: 'json' | 'yaml') {
    const text = format === 'yaml' ? SLACK_MANIFEST_YAML : SLACK_MANIFEST_JSON
    const copied = await copyTextToClipboard(text).catch(() => false)
    if (!copied) {
      setError('Copy failed. Your browser blocked clipboard access — select the manifest text and copy it manually.')
      return
    }

    setError(null)
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
        setError(getApiErrorMessage(data?.error, data?.message))
        return
      }

      setAgents(data.agents)
      setIntegration(data.integration)
      setDefaultAgentId(data.integration.defaultAgentId ?? '')
      setBotToken('')
      setAppToken('')
      onMutated?.()
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
        setError(getApiErrorMessage(data?.error, data?.message))
        return
      }

      setTestResult(data)
    } catch {
      setError(getErrorMessage('network_error'))
    } finally {
      setBusyAction(null)
    }
  }

  const statusBadge = integration ? (
    <Badge variant={getStatusVariant(integration.status)}>{getStatusLabel(integration.status)}</Badge>
  ) : null

  const loadingIndicator = isLoading ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <SpinnerGap size={14} className="animate-spin" />
      Loading…
    </span>
  ) : null

  const detailsId = 'slack-integration-details'
  const isEnabled = integration?.enabled ?? false
  const showDetails = collapsible ? isExpanded : true

  const headerContent = (
    <>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">Slack integration</h2>
          {statusBadge}
          {loadingIndicator}
        </div>
        <p className="text-sm text-muted-foreground">
          Connect a Slack bot so your workspace can chat with Arche agents directly from Slack
          channels.
        </p>
      </div>
      {collapsible ? (
        <CaretDown
          size={16}
          weight="bold"
          className={cn(
            'shrink-0 text-muted-foreground transition-transform',
            showDetails && 'rotate-180',
          )}
        />
      ) : null}
    </>
  )

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={showDetails}
          aria-controls={detailsId}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex items-start justify-between gap-4">
          {headerContent}
        </div>
      )}

      {showDetails ? (
        <div id={detailsId} className="space-y-6 pt-2">
          {error ? <SettingsInfoBox tone="error">{error}</SettingsInfoBox> : null}

          {testResult ? (
            <SettingsInfoBox tone="success">
              <p className="font-medium text-foreground">Test connection succeeded.</p>
              <p className="mt-1 text-muted-foreground">
                Team: {testResult.teamId ?? 'unknown'} | App: {testResult.appId ?? 'unknown'} | Bot user:{' '}
                {testResult.botUserId ?? 'unknown'}
              </p>
            </SettingsInfoBox>
          ) : null}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Setup</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Create an internal Slack app from the manifest below.</li>
              <li>Enable Socket Mode.</li>
              <li>Install the app in your Slack workspace.</li>
              <li>Generate an app-level token with <code>connections:write</code>.</li>
              <li>Paste the bot token and app token here.</li>
              <li>Invite the bot to the channels where it should operate.</li>
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
                disabled={busyAction !== null}
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
                disabled={busyAction !== null}
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
                  disabled={busyAction !== null}
                  className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Use primary agent</option>
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

            <div className="flex">
              <Button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void mutateIntegration('enable')}
              >
                {busyAction === 'enable'
                  ? isEnabled
                    ? 'Saving...'
                    : 'Enabling...'
                  : isEnabled
                    ? 'Save changes'
                    : 'Enable'}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-foreground">Slack manifest</h3>
              <div className="inline-flex h-6 items-center rounded-md bg-foreground/[0.06] p-[2px]">
                <button
                  type="button"
                  onClick={() => setManifestFormat('yaml')}
                  aria-pressed={manifestFormat === 'yaml'}
                  className={cn(
                    'flex h-[calc(1.5rem-4px)] items-center rounded-[4px] px-2 text-[11px] font-medium transition-all',
                    manifestFormat === 'yaml'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  YAML
                </button>
                <button
                  type="button"
                  onClick={() => setManifestFormat('json')}
                  aria-pressed={manifestFormat === 'json'}
                  className={cn(
                    'flex h-[calc(1.5rem-4px)] items-center rounded-[4px] px-2 text-[11px] font-medium transition-all',
                    manifestFormat === 'json'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  JSON
                </button>
              </div>
            </div>
            <div className="relative">
              <pre className="scrollbar-custom max-h-80 overflow-auto rounded-lg bg-muted/40 p-3 pr-10 text-xs text-foreground">
                {manifestFormat === 'yaml' ? SLACK_MANIFEST_YAML : SLACK_MANIFEST_JSON}
              </pre>
              <button
                type="button"
                onClick={() => void handleCopy(manifestFormat)}
                aria-label={copyState === manifestFormat ? 'Copied' : 'Copy manifest'}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                {copyState === manifestFormat ? (
                  <Check size={14} weight="bold" />
                ) : (
                  <Copy size={14} weight="regular" />
                )}
              </button>
            </div>
          </div>

          {isEnabled ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-foreground">Notification channels</h3>
                  <p className="text-xs text-muted-foreground">
                    Channels where Autopilot can proactively send notifications. Thread replies work separately whenever Arche is mentioned in a channel where the bot is present.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshSlackChannels()}
                  disabled={isRefreshingChannels}
                >
                  {isRefreshingChannels ? 'Refreshing...' : 'Refresh channels'}
                </Button>
              </div>

              {notificationChannels.length === 0 ? (
                <p className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm text-muted-foreground">
                  No channels found. Invite the bot to Slack channels, then click refresh to load them from Slack.
                </p>
              ) : (
                <div className="space-y-2">
                  {notificationChannels.map((channel) => (
                    <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {channel.isPrivate ? (
                          <Lock size={14} className="shrink-0 text-muted-foreground" />
                        ) : (
                          <Hash size={14} className="shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate text-sm text-foreground">{channel.name}</span>
                      </div>
                      <Switch
                        checked={channel.enabled}
                        onCheckedChange={(checked) => void setChannelEnabled(channel.id, checked)}
                        aria-label={`Enable notifications to ${channel.name}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {showDangerZone && isEnabled ? (
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-destructive">Danger zone</h3>
                <p className="text-sm text-muted-foreground">
                  Disabling the integration stops the Socket Mode connection and clears stored tokens.
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busyAction !== null}
                onClick={() => void mutateIntegration('disable')}
              >
                {busyAction === 'disable' ? 'Disabling...' : 'Disable integration'}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4 lg:border-l lg:border-border/60 lg:pl-8">
          <h3 className="text-sm font-medium text-foreground">Diagnostics</h3>

          <dl className="divide-y divide-border/50 text-sm">
            <DiagnosticRow label="Team ID" value={integration?.slackTeamId ?? 'Unknown'} mono />
            <DiagnosticRow label="App ID" value={integration?.slackAppId ?? 'Unknown'} mono />
            <DiagnosticRow label="Bot User ID" value={integration?.slackBotUserId ?? 'Unknown'} mono />
            <DiagnosticRow label="Config Version" value={String(integration?.version ?? 0)} mono />
            <DiagnosticRow label="Last Connection" value={formatTimestamp(integration?.lastSocketConnectedAt ?? null)} />
            <DiagnosticRow label="Last Event" value={formatTimestamp(integration?.lastEventAt ?? null)} />
          </dl>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Saved tokens</p>
            <ul className="space-y-1 text-sm">
              <TokenStatusRow label="Bot token" saved={integration?.hasBotToken ?? false} />
              <TokenStatusRow label="App token" saved={integration?.hasAppToken ?? false} />
            </ul>
          </div>

          {integration?.lastError ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Last error</p>
              <p className="break-words rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {integration.lastError}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyAction !== null}
              onClick={() => void handleTestConnection()}
            >
              {busyAction === 'test' ? 'Testing...' : 'Test connection'}
            </Button>
            {isEnabled ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyAction !== null}
                onClick={() => void mutateIntegration('reconnect')}
              >
                {busyAction === 'reconnect' ? 'Reconnecting...' : 'Reconnect'}
              </Button>
            ) : null}
          </div>
        </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function DiagnosticRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 break-all text-right text-foreground',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function TokenStatusRow({ label, saved }: { label: string; saved: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {saved ? (
        <CheckCircle size={16} weight="fill" className="text-foreground" aria-label="Saved" />
      ) : (
        <XCircle size={16} weight="fill" className="text-muted-foreground" aria-label="Missing" />
      )}
      <span className={saved ? 'text-foreground' : 'text-muted-foreground'}>
        {label}
        <span className="ml-1 text-xs text-muted-foreground">
          ({saved ? 'Saved' : 'Missing'})
        </span>
      </span>
    </li>
  )
}
