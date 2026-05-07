'use client'

import { useEffect, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { AgentCard } from '@/components/agents/agent-card'
import { AgentForm } from '@/components/agents/agent-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'

type AgentsSettingsPanelProps = {
  slug: string
}

type EditorState =
  | { mode: 'create' }
  | { agentId: string; mode: 'edit' }

type ModelOption = {
  id: string
  label: string
}

export function AgentsSettingsPanel({ slug }: AgentsSettingsPanelProps) {
  const { agents, defaultModel, hash, isLoading, loadError, reload } = useAgentsCatalog(slug)
  const [editorState, setEditorState] = useState<EditorState | null>(null)
  const [defaultModelInput, setDefaultModelInput] = useState('')
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [isSavingDefaultModel, setIsSavingDefaultModel] = useState(false)
  const [defaultModelMessage, setDefaultModelMessage] = useState<string | null>(null)
  const [defaultModelError, setDefaultModelError] = useState<string | null>(null)

  const primaryAgent = agents.find((agent) => agent.isPrimary) ?? null
  const experts = agents.filter((agent) => !agent.isPrimary)
  const editingAgent =
    editorState?.mode === 'edit'
      ? agents.find((agent) => agent.id === editorState.agentId) ?? null
      : null

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

  async function handleEditorFinished() {
    await reload()
    setEditorState(null)
  }

  async function handleSaveDefaultModel() {
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
          <div className="rounded-xl border border-border/60 bg-card/40 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="desktop-workspace-default-model">Default model</Label>
                <Input
                  id="desktop-workspace-default-model"
                  list="desktop-workspace-default-model-options"
                  value={defaultModelInput}
                  onChange={(event) => setDefaultModelInput(event.target.value)}
                  placeholder="Select or type a model"
                />
                <datalist id="desktop-workspace-default-model-options">
                  {modelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Agents without an override inherit this workspace model.
                </p>
              </div>
              <Button type="button" onClick={handleSaveDefaultModel} disabled={isSavingDefaultModel}>
                {isSavingDefaultModel ? 'Saving...' : 'Save default model'}
              </Button>
            </div>
            {defaultModelMessage ? <p className="mt-3 text-sm text-muted-foreground">{defaultModelMessage}</p> : null}
            {defaultModelError ? <p className="mt-3 text-sm text-destructive">Error: {defaultModelError}</p> : null}
          </div>

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
                resolvedModel={primaryAgent.resolvedModel}
                usesDefaultModel={primaryAgent.usesDefaultModel}
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
                    resolvedModel={agent.resolvedModel}
                    usesDefaultModel={agent.usesDefaultModel}
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
