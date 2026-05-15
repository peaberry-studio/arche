'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'

type KbGithubRemoteSummaryCardProps = {
  integration: KbGithubRemoteIntegrationSummary
  slug: string
}

export function KbGithubRemoteSummaryCard({ integration, slug }: KbGithubRemoteSummaryCardProps) {
  const href = `/u/${slug}/settings/integrations/kb-github-remote`

  return (
    <section className="space-y-5 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">GitHub KB sync</h2>
            <Badge variant={getStatusVariant(integration)}>{getStatusLabel(integration)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Back up and sync the shared knowledge base with a GitHub repository.
          </p>
          {integration.repoFullName ? (
            <p className="text-xs text-muted-foreground">
              Connected to <span className="font-medium text-foreground">{integration.repoFullName}</span>
            </p>
          ) : null}
        </div>

        <Button asChild size="sm">
          <Link href={href}>{integration.ready ? 'Manage' : 'Setup'}</Link>
        </Button>
      </div>
    </section>
  )
}

function getStatusVariant(
  integration: KbGithubRemoteIntegrationSummary,
): 'default' | 'secondary' | 'warning' | 'outline' {
  if (integration.ready) return 'default'
  if (integration.lastSyncStatus === 'error') return 'warning'
  if (integration.installationId) return 'outline'
  return 'secondary'
}

function getStatusLabel(integration: KbGithubRemoteIntegrationSummary): string {
  if (integration.ready) return 'Connected'
  if (integration.installationId) return 'Choose repo'
  if (integration.appConfigured) return 'Install app'
  return 'Not configured'
}
