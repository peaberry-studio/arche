'use client'

import { useEffect, useState } from 'react'
import { Robot, SpinnerGap } from '@phosphor-icons/react'

import { AgentCard } from '@/components/agents/agent-card'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'

type AgentsPageClientProps = {
  includePrimary?: boolean
  slug: string
  isAdmin: boolean
  loadingLabel?: string
}

type ModelOption = {
  id: string
  label: string
}

export function AgentsPageClient({
  slug,
  isAdmin,
  includePrimary = true,
  loadingLabel = 'Loading agents...',
}: AgentsPageClientProps) {
  const { agents, defaultModel, hash, isLoading, loadError, reload } = useAgentsCatalog(slug)
  const [defaultModelInput, setDefaultModelInput] = useState('')
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [isSavingDefaultModel, setIsSavingDefaultModel] = useState(false)
  const [defaultModelMessage, setDefaultModelMessage] = useState<string | null>(null)
  const [defaultModelError, setDefaultModelError] = useState<string | null>(null)

  const visibleAgents = includePrimary ? agents : agents.filter((agent) => !agent.isPrimary)

  useEffect(() => {
    setDefaultModelInput(defaultModel ?? '')
  }, [defaultModel])

  useEffect(() => {
    let cancelled = false

    fetch(`/api/u/${slug}/agents/models`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return
        const data = (await response.json().catch(() => null)) as { models?: ModelOption[] } | null
        if (!cancelled) setModelOptions(data?.models ?? [])
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [slug])

  const handleSaveDefaultModel = async () => {
    if (isSavingDefaultModel) return

    setIsSavingDefaultModel(true)
    setDefaultModelMessage(null)
    setDefaultModelError(null)

    try {
      const response = await fetch(`/api/u/${slug}/agents/default-model`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          defaultModel: defaultModelInput.trim() || null,
          expectedHash: hash,
        }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setDefaultModelError(data?.error ?? 'save_failed')
        return
      }

      setDefaultModelMessage('Default model saved.')
      notifyWorkspaceConfigChanged()
      await reload()
    } catch {
      setDefaultModelError('network_error')
    } finally {
      setIsSavingDefaultModel(false)
    }
  }

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

      {!isLoading && !loadError ? (
        <div className="space-y-2 rounded-xl border border-border/60 bg-card/60 p-4">
          <Label htmlFor="workspace-default-model">Default model</Label>
          {isAdmin ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="workspace-default-model"
                  list="workspace-default-model-options"
                  value={defaultModelInput}
                  onChange={(event) => setDefaultModelInput(event.target.value)}
                  placeholder="Select or type a model"
                  className="sm:flex-1"
                />
                <Button
                  type="button"
                  onClick={handleSaveDefaultModel}
                  disabled={isSavingDefaultModel}
                  className="sm:shrink-0"
                >
                  {isSavingDefaultModel ? 'Saving...' : 'Save default model'}
                </Button>
              </div>
              <datalist id="workspace-default-model-options">
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{defaultModel ?? 'No default model configured.'}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Agents without an override inherit this workspace model.
          </p>
          {defaultModelMessage ? <p className="text-sm text-muted-foreground">{defaultModelMessage}</p> : null}
          {defaultModelError ? <p className="text-sm text-destructive">Error: {defaultModelError}</p> : null}
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
            resolvedModel={agent.resolvedModel}
            usesDefaultModel={agent.usesDefaultModel}
            isPrimary={agent.isPrimary}
            isAdmin={isAdmin}
            editHref={`/u/${slug}/agents/${agent.id}`}
          />
        ))}
      </div>
    </div>
  )
}
