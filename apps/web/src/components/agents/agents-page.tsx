'use client'

import { SpinnerGap } from '@phosphor-icons/react'

import { AgentCard } from '@/components/agents/agent-card'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'

type AgentsPageClientProps = {
  emptyMessage?: string
  includePrimary?: boolean
  slug: string
  isAdmin: boolean
  loadingLabel?: string
}

export function AgentsPageClient({
  slug,
  isAdmin,
  includePrimary = true,
  loadingLabel = 'Loading agents...',
  emptyMessage = 'No agents configured yet.',
}: AgentsPageClientProps) {
  const { agents, isLoading, loadError } = useAgentsCatalog(slug)

  const visibleAgents = includePrimary ? agents : agents.filter((agent) => !agent.isPrimary)

  return (
    <div className="space-y-4">
      {isLoading && (
        <div className="flex min-h-[220px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin" />
            {loadingLabel}
          </div>
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
          Failed to load: {loadError}
        </div>
      )}

      {!isLoading && visibleAgents.length === 0 && !loadError ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {visibleAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            displayName={agent.displayName}
            agentId={agent.id}
            description={agent.description}
            model={agent.model}
            isPrimary={agent.isPrimary}
            isAdmin={isAdmin}
            editHref={`/u/${slug}/agents/${agent.id}`}
          />
        ))}
      </div>
    </div>
  )
}
