import Link from 'next/link'

import { Button } from '@/components/ui/button'

type McpIntegrationSummaryCardProps = {
  slug: string
}

export function McpIntegrationSummaryCard({ slug }: McpIntegrationSummaryCardProps) {
  const href = `/u/${slug}/settings/integrations/mcp`

  return (
    <section className="space-y-5 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-foreground">MCP Access</h2>
          <p className="text-sm text-muted-foreground">
            Connect external MCP clients to Arche workspace context with scoped personal access tokens.
          </p>
        </div>

        <Button asChild size="sm">
          <Link href={href}>Setup</Link>
        </Button>
      </div>
    </section>
  )
}
