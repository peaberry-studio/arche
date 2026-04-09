'use client'

import { useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { AgentCard } from '@/components/agents/agent-card'
import { AgentForm } from '@/components/agents/agent-form'
import { Button } from '@/components/ui/button'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'

type AgentsSettingsPanelProps = {
  slug: string
}

type EditorState =
  | { mode: 'create' }
  | { agentId: string; mode: 'edit' }

export function AgentsSettingsPanel({ slug }: AgentsSettingsPanelProps) {
  const { agents, isLoading, loadError, reload } = useAgentsCatalog(slug)
  const [editorState, setEditorState] = useState<EditorState | null>(null)

  const primaryAgent = agents.find((agent) => agent.isPrimary) ?? null
  const experts = agents.filter((agent) => !agent.isPrimary)
  const editingAgent =
    editorState?.mode === 'edit'
      ? agents.find((agent) => agent.id === editorState.agentId) ?? null
      : null

  async function handleEditorFinished() {
    await reload()
    setEditorState(null)
  }

  if (editorState) {
    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            {editorState.mode === 'create' ? 'Create expert' : `Edit ${editingAgent?.displayName ?? 'agent'}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {editorState.mode === 'create'
              ? 'Define the role, model, and prompt for a new expert.'
              : 'Update the role, model, prompt, and capabilities for this agent.'}
          </p>
        </div>

        <AgentForm
          slug={slug}
          mode={editorState.mode}
          agentId={editorState.mode === 'edit' ? editorState.agentId : undefined}
          allowPrimarySelection={false}
          cancelLabel="Back to agents"
          onCancel={() => setEditorState(null)}
          onDeleted={handleEditorFinished}
          onSaved={handleEditorFinished}
        />
      </section>
    )
  }

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-lg font-medium text-foreground">Agents</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the primary assistant and the specialist experts available in this desktop workspace.
        </p>
      </div>

      {isLoading ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin" />
            Loading agents...
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
          <p className="text-sm text-destructive">Failed to load: {loadError}</p>
          <Button type="button" variant="outline" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}

      {!isLoading && !loadError ? (
        <>
          <div className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">Primary agent</h3>
              <p className="text-sm text-muted-foreground">
                This is the default assistant used for the main workspace experience.
              </p>
            </div>

            {primaryAgent ? (
              <AgentCard
                agentId={primaryAgent.id}
                displayName={primaryAgent.displayName}
                description={primaryAgent.description}
                model={primaryAgent.model}
                isPrimary
                isAdmin
                editLabel="Edit primary agent"
                onEdit={() => setEditorState({ mode: 'edit', agentId: primaryAgent.id })}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 bg-card/30 p-4 text-sm text-muted-foreground">
                No primary agent is configured.
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">Experts</h3>
                <p className="text-sm text-muted-foreground">
                  Add and maintain specialist agents for focused tasks.
                </p>
              </div>

              <Button type="button" variant="outline" onClick={() => setEditorState({ mode: 'create' })}>
                Create expert
              </Button>
            </div>

            {experts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-card/30 p-4 text-sm text-muted-foreground">
                No experts configured yet.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {experts.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agentId={agent.id}
                    displayName={agent.displayName}
                    description={agent.description}
                    model={agent.model}
                    isPrimary={false}
                    isAdmin
                    editLabel={`Edit ${agent.displayName}`}
                    onEdit={() => setEditorState({ mode: 'edit', agentId: agent.id })}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
