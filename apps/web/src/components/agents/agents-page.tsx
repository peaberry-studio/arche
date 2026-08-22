'use client'

import Link from 'next/link'
import { Robot, SpinnerGap } from '@phosphor-icons/react'

import { AgentCard } from '@/components/agents/agent-card'
import { WorkspaceDefaultModelControl } from '@/components/agents/workspace-default-model-control'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { Button } from '@/components/ui/button'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

type AgentsPageClientProps = {
  createHref?: string
  includePrimary?: boolean
  isAdmin: boolean
  onEdit?: (agentId: string) => void
  slug: string
  loadingLabel?: string
}

export function AgentsPageClient({
  slug,
  isAdmin,
  includePrimary = true,
  loadingLabel = 'Loading agents...',
  createHref = getWorkspaceCatalogHref(slug, 'agents', 'new'),
  onEdit,
}: AgentsPageClientProps) {
  const { agents, defaultModel, hash, isLoading, loadError, reload } = useAgentsCatalog(slug)

  const visibleAgents = includePrimary ? agents : agents.filter((agent) => !agent.isPrimary)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="type-display text-3xl font-semibold tracking-tight">Agents</h1>
          <p className="text-muted-foreground">
            Review shared agents defined in the knowledge base.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isLoading && !loadError ? (
            <WorkspaceDefaultModelControl
              defaultModel={defaultModel}
              hash={hash}
              inputId="workspace-default-model"
              isAdmin={isAdmin}
              onSaved={reload}
              slug={slug}
            />
          ) : null}
          {isAdmin ? (
            <Button type="button" variant="outline" asChild>
              <Link href={createHref}>Create agent</Link>
            </Button>
          ) : null}
        </div>
      </div>

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
              isAdmin ? { label: 'Create your first agent', href: createHref } : undefined
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
              resolvedModel={agent.resolvedModel}
              usesDefaultModel={agent.usesDefaultModel}
              isPrimary={agent.isPrimary}
              isAdmin={isAdmin}
              editHref={onEdit ? undefined : getWorkspaceCatalogHref(slug, 'agents', agent.id)}
              onEdit={onEdit ? () => onEdit(agent.id) : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
