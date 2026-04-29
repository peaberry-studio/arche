'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'

type KbGithubRemoteSummaryCardProps = {
  slug: string
  integration: KbGithubRemoteIntegrationSummary
}

export function KbGithubRemoteSummaryCard({
  slug,
  integration,
}: KbGithubRemoteSummaryCardProps) {
  const href = `/u/${slug}/settings/integrations/kb-github-remote`

  return (
    <section className="space-y-5 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">GitHub KB Backup</h2>
            <Badge variant={integration.ready ? 'default' : integration.appConfigured ? 'secondary' : 'secondary'}>
              {integration.ready ? 'Ready' : integration.appConfigured ? 'Partially configured' : 'Not configured'}
            </Badge>
            {integration.lastSyncStatus === 'error' ? (
              <Badge variant="destructive">Sync error</Badge>
            ) : null}
            {integration.lastSyncStatus === 'conflicts' ? (
              <Badge variant="secondary" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                Conflicts
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Back up and sync your knowledge base with a GitHub repository.
          </p>
          {integration.lastSyncAt ? (
            <p className="text-xs text-muted-foreground">
              Last synced {new Date(integration.lastSyncAt).toLocaleString()}
            </p>
          ) : null}
        </div>

        <Button asChild size="sm">
          <Link href={href}>Setup</Link>
        </Button>
      </div>
    </section>
  )
}
