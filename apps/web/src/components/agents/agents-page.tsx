'use client'

import { Robot, SpinnerGap } from '@phosphor-icons/react'

import { AgentCard } from '@/components/agents/agent-card'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'

type AgentsPageClientProps = {
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
        <DashboardEmptyState
          icon={Robot}
          title="No agents configured yet"
          description="Agents are personas with their own model, system prompt, and skills. Create one to handle a specific kind of work."
          primaryAction={
            isAdmin ? { label: 'Create your first agent', href: `/u/${slug}/agents/new` } : undefined
          }
        />
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
