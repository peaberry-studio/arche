'use client'

import Link from 'next/link'

import { CaretRight, CheckCircle, XCircle } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import type { SlackIntegrationStatus, SlackIntegrationSummary } from '@/lib/slack/types'

type SlackIntegrationSummaryCardProps = {
  slug: string
  integration: SlackIntegrationSummary
}

export function SlackIntegrationSummaryCard({ slug, integration }: SlackIntegrationSummaryCardProps) {
  const href = `/u/${slug}/settings/integrations/slack`
  const tokenStatus = getTokenStatus(integration)

  return (
    <Link
      href={href}
      className="group block rounded-lg border border-border/60 bg-card/50 p-6 transition-colors hover:border-primary/30 hover:bg-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">Slack integration</h2>
            <Badge variant={getStatusVariant(integration.status)}>{getStatusLabel(integration.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage the Slack bot connection, diagnostics, and provider access for the reserved{' '}
            <code>slack-bot</code> service workspace.
          </p>
        </div>

        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          Open settings
          <CaretRight
            size={14}
            weight="bold"
            className="transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryValue label="Tokens" value={tokenStatus.label} />
        <SummaryValue
          label="Last connection"
          value={integration.lastSocketConnectedAt ? formatTimestamp(integration.lastSocketConnectedAt) : 'Never'}
        />
        <SummaryValue
          label="Last event"
          value={integration.lastEventAt ? formatTimestamp(integration.lastEventAt) : 'Never'}
        />
        <SummaryValue label="Bot user" value={integration.slackBotUserId ?? 'Unknown'} mono />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
        <TokenIndicator label="Bot token" saved={integration.hasBotToken} />
        <TokenIndicator label="App token" saved={integration.hasAppToken} />
      </div>

      {integration.lastError ? (
        <p className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {integration.lastError}
        </p>
      ) : null}
    </Link>
  )
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

function getTokenStatus(integration: SlackIntegrationSummary): { label: string } {
  if (integration.hasBotToken && integration.hasAppToken) {
    return { label: 'Ready' }
  }
  if (integration.hasBotToken || integration.hasAppToken) {
    return { label: 'Incomplete' }
  }

  return { label: 'Missing' }
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown'
  }

  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function SummaryValue({ label, mono, value }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1 rounded-lg border border-border/50 bg-background/60 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={mono ? 'break-all font-mono text-xs text-foreground' : 'text-sm text-foreground'}>
        {value}
      </p>
    </div>
  )
}

function TokenIndicator({ label, saved }: { label: string; saved: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      {saved ? (
        <CheckCircle size={16} weight="fill" className="text-foreground" aria-label="Saved" />
      ) : (
        <XCircle size={16} weight="fill" className="text-muted-foreground" aria-label="Missing" />
      )}
      <span className={saved ? 'text-foreground' : undefined}>
        {label}
        <span className="ml-1 text-xs text-muted-foreground">({saved ? 'Saved' : 'Missing'})</span>
      </span>
    </span>
  )
}
