'use client'

import { useCallback, useEffect, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { AgentCard } from '@/components/agents/agent-card'

type AgentListItem = {
  id: string
  displayName: string
  description?: string
  model?: string
  temperature?: number
  isPrimary: boolean
}

type AgentsPageClientProps = {
  slug: string
  isAdmin: boolean
}

export function AgentsPageClient({ slug, isAdmin }: AgentsPageClientProps) {
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadAgents = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await fetch(`/api/u/${slug}/agents`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { agents?: AgentListItem[]; hash?: string; error?: string } | null
      if (!response.ok || !data) {
        setLoadError(data?.error ?? 'load_failed')
        return
      }
      setAgents(data.agents ?? [])
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  return (
    <div className="space-y-4">
      {isLoading && (
        <div className="flex min-h-[220px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin" />
            Loading agents...
          </div>
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
          Failed to load: {loadError}
        </div>
      )}

      {!isLoading && agents.length === 0 && !loadError ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
          No agents configured yet.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((agent) => (
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
