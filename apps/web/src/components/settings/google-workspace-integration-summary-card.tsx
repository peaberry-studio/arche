'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GoogleWorkspaceIntegrationSummary } from '@/lib/google-workspace/types'

type GoogleWorkspaceIntegrationSummaryCardProps = {
  slug: string
  integration: GoogleWorkspaceIntegrationSummary
}

export function GoogleWorkspaceIntegrationSummaryCard({
  slug,
  integration,
}: GoogleWorkspaceIntegrationSummaryCardProps) {
  const href = `/u/${slug}/settings/integrations/google-workspace`

  return (
    <section className="space-y-5 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">Google Workspace integration</h2>
            <Badge variant={integration.configured ? 'default' : 'secondary'}>
              {integration.configured ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage the Google Workspace OAuth client credentials used for all Google connectors.
          </p>
        </div>

        <Button asChild size="sm">
          <Link href={href}>Setup</Link>
        </Button>
      </div>
    </section>
  )
}
