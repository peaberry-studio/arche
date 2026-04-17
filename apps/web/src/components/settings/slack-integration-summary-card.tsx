'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SlackIntegrationStatus, SlackIntegrationSummary } from '@/lib/slack/types'

type SlackIntegrationSummaryCardProps = {
  slug: string
  integration: SlackIntegrationSummary
}

export function SlackIntegrationSummaryCard({ slug, integration }: SlackIntegrationSummaryCardProps) {
  const href = `/u/${slug}/settings/integrations/slack`

  return (
    <section className="space-y-5 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">Slack integration</h2>
            <Badge variant={getStatusVariant(integration.status)}>{getStatusLabel(integration.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage the Slack bot connection and provider access for the reserved{' '}
            <code>slack-bot</code> service workspace.
          </p>
        </div>

        <Button asChild size="sm">
          <Link href={href}>Setup</Link>
        </Button>
      </div>
    </section>
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
