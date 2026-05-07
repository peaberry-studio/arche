'use client'

import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Info, SpinnerGap } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  OPENCODE_AGENT_TOOL_OPTIONS,
  type AgentCapabilities,
  type OpenCodeAgentToolId,
} from '@/lib/agent-capabilities'
import type { AgentConnectorCapabilityOption } from '@/lib/agent-connector-capabilities'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'
import { cn } from '@/lib/utils'

type AgentFormProps = {
  agentId?: string
  allowPrimarySelection?: boolean
  cancelLabel?: string
  mode: 'create' | 'edit'
  onCancel?: () => void
  onDeleted?: (result: { agentId: string }) => void | Promise<void>
  onSaved?: (result: { agentId: string; mode: 'create' | 'edit' }) => void | Promise<void>
  slug: string
}

type ModelOption = {
  id: string
  label: string
}

type SkillListItem = {
  description: string
  name: string
}

export function AgentForm({
  slug,
  mode,
  agentId,
  allowPrimarySelection = true,
  cancelLabel = 'Cancel',
  onCancel,
  onDeleted,
  onSaved,
}: AgentFormProps) {
  const [id, setId] = useState(agentId ?? '')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('')
  const [defaultModel, setDefaultModel] = useState<string | undefined>()
  const [usesDefaultModel, setUsesDefaultModel] = useState(true)
  const [temperature, setTemperature] = useState('')
  const [prompt, setPrompt] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [enabledTools, setEnabledTools] = useState<OpenCodeAgentToolId[]>([])
  const [enabledMcpConnectorIds, setEnabledMcpConnectorIds] = useState<string[]>([])
  const [enabledSkillIds, setEnabledSkillIds] = useState<string[]>([])
  const [connectors, setConnectors] = useState<AgentConnectorCapabilityOption[]>([])
  const [skills, setSkills] = useState<SkillListItem[]>([])
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [hash, setHash] = useState<string | undefined>()
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const checkboxClassName =
    'h-4 w-4 rounded border border-border/70 bg-card/70 accent-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

  useEffect(() => {
    let cancelled = false

    async function loadFormOptions() {
      const [modelsResponse, connectorsResponse, skillsResponse] = await Promise.all([
        fetch(`/api/u/${slug}/agents/models`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/u/${slug}/agents/connectors`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/u/${slug}/skills`, { cache: 'no-store' }).catch(() => null),
      ])

      if (cancelled) return

      if (modelsResponse?.ok) {
        const data = (await modelsResponse.json().catch(() => null)) as
          | { models?: ModelOption[] }
          | null
        setModelOptions(data?.models ?? [])
      }

      if (connectorsResponse?.ok) {
        const data = (await connectorsResponse.json().catch(() => null)) as
          | { connectors?: AgentConnectorCapabilityOption[] }
          | null
        const availableConnectors = data?.connectors ?? []
        setConnectors(availableConnectors)
        setEnabledMcpConnectorIds((current) =>
          current.filter((connectorId) =>
            availableConnectors.some((connector) => connector.id === connectorId)
          )
        )
      }

      if (skillsResponse?.ok) {
        const data = (await skillsResponse.json().catch(() => null)) as
          | { skills?: SkillListItem[] }
          | null
        const availableSkills = data?.skills ?? []
        setSkills(availableSkills)
        setEnabledSkillIds((current) => current.filter((skillId) => availableSkills.some((skill) => skill.name === skillId)))
      }
    }

    loadFormOptions().catch(() => {})

    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (mode === 'edit' && agentId) {
      setIsLoading(true)
      setLoadError(null)
      fetch(`/api/u/${slug}/agents/${agentId}`, { cache: 'no-store' })
        .then(async (response) => {
          const data = (await response.json().catch(() => null)) as
            | {
                agent?: {
                  id: string
                  displayName?: string
                  description?: string
                  defaultModel?: string
                  model?: string
                  resolvedModel?: string
                  temperature?: number
                  prompt?: string
                  usesDefaultModel?: boolean
                  isPrimary: boolean
                  capabilities?: AgentCapabilities
                }
                hash?: string
                error?: string
              }
            | null

          if (!response.ok || !data?.agent) {
            setLoadError(data?.error ?? 'load_failed')
            return
          }

          setId(data.agent.id)
          setDisplayName(data.agent.displayName ?? data.agent.id)
          setDescription(data.agent.description ?? '')
          setDefaultModel(data.agent.defaultModel)
          setUsesDefaultModel(data.agent.usesDefaultModel ?? !data.agent.model)
          setModel(data.agent.model ?? data.agent.resolvedModel ?? data.agent.defaultModel ?? '')
          setTemperature(typeof data.agent.temperature === 'number' ? String(data.agent.temperature) : '')
          setPrompt(data.agent.prompt ?? '')
          setIsPrimary(data.agent.isPrimary)
          setEnabledTools((data.agent.capabilities?.tools ?? []) as OpenCodeAgentToolId[])
          setEnabledMcpConnectorIds(data.agent.capabilities?.mcpConnectorIds ?? [])
          setEnabledSkillIds(data.agent.capabilities?.skillIds ?? [])
          setHash(data.hash)
        })
        .catch(() => setLoadError('network_error'))
        .finally(() => setIsLoading(false))
      return
    }

    if (mode === 'create') {
      fetch(`/api/u/${slug}/agents`, { cache: 'no-store' })
        .then(async (response) => {
          const data = (await response.json().catch(() => null)) as {
            defaultModel?: string
            hash?: string
          } | null
          if (response.ok && data?.hash) {
            setHash(data.hash)
          }
          if (response.ok) {
            setDefaultModel(data?.defaultModel)
            setModel(data?.defaultModel ?? '')
          }
        })
        .catch(() => {})
    }
  }, [agentId, mode, slug])

  const handleSetPrimary = async () => {
    if (!agentId) return
    setSaveError(null)
    setIsSaving(true)
    try {
      const response = await fetch(`/api/u/${slug}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPrimary: true, expectedHash: hash }),
      })
      const data = (await response.json().catch(() => null)) as { hash?: string; error?: string } | null
      if (!response.ok) {
        setSaveError(data?.error ?? 'update_failed')
        return
      }
      setHash(data?.hash)
      setIsPrimary(true)
      setSaveSuccess(true)
      notifyWorkspaceConfigChanged()
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch {
      setSaveError('network_error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!agentId) return
    const confirmed = window.confirm(`Delete the agent "${displayName || agentId}"?`)
    if (!confirmed) return

    setSaveError(null)
    setIsSaving(true)
    try {
      const response = await fetch(`/api/u/${slug}/agents/${agentId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedHash: hash }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          setSaveError(data?.error ?? 'delete_failed')
          return
        }

        notifyWorkspaceConfigChanged()
        await onDeleted?.({ agentId })
      } catch {
        setSaveError('network_error')
      } finally {
      setIsSaving(false)
    }
  }

  const toggleTool = (toolId: OpenCodeAgentToolId) => {
    setEnabledTools((current) =>
      current.includes(toolId) ? current.filter((idEntry) => idEntry !== toolId) : [...current, toolId]
    )
  }

  const toggleMcpConnector = (connectorId: string) => {
    setEnabledMcpConnectorIds((current) =>
      current.includes(connectorId)
        ? current.filter((idEntry) => idEntry !== connectorId)
        : [...current, connectorId]
    )
  }

  const toggleSkill = (skillId: string) => {
    setEnabledSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((idEntry) => idEntry !== skillId)
        : [...current, skillId]
    )
  }

  const handleUsesDefaultModelChange = (checked: boolean) => {
    setUsesDefaultModel(checked)
    if (!checked && !model.trim() && defaultModel) {
      setModel(defaultModel)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving) return
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    if (!displayName.trim()) {
      setSaveError('Display name is required.')
      setIsSaving(false)
      return
    }

    const capabilities: AgentCapabilities = {
      skillIds: enabledSkillIds,
      tools: enabledTools,
      mcpConnectorIds: enabledMcpConnectorIds,
    }

    try {
      if (mode === 'create') {
        const payload = {
          displayName: displayName.trim(),
          description: description.trim() || undefined,
          model: usesDefaultModel ? null : model.trim() || null,
          temperature: temperature.trim() ? Number(temperature) : undefined,
          prompt,
          isPrimary,
          expectedHash: hash,
          capabilities,
        }
        const response = await fetch(`/api/u/${slug}/agents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await response.json().catch(() => null)) as {
          agent?: { id: string }
          error?: string
          hash?: string
        } | null
        if (!response.ok) {
          setSaveError(data?.error ?? 'create_failed')
          return
        }

        setHash(data?.hash)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
        notifyWorkspaceConfigChanged()
        await onSaved?.({ agentId: data?.agent?.id ?? id, mode })
        return
      }

      const payload = {
        displayName: displayName.trim() ? displayName.trim() : null,
        description: description.trim() ? description.trim() : null,
        model: usesDefaultModel ? null : model.trim() || null,
        temperature: temperature.trim() ? Number(temperature) : null,
        prompt,
        expectedHash: hash,
        capabilities,
      }
      const response = await fetch(`/api/u/${slug}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await response.json().catch(() => null)) as { hash?: string; error?: string } | null
      if (!response.ok) {
        setSaveError(data?.error ?? 'update_failed')
        return
      }
      setHash(data?.hash)
      setSaveSuccess(true)
      notifyWorkspaceConfigChanged()
      await onSaved?.({ agentId: agentId ?? id, mode })
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch {
      setSaveError('network_error')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          Loading agent...
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
        Failed to load: {loadError}
      </div>
    )
  }

  const hasCurrentModel = modelOptions.some((option) => option.id === model)
  const saveLabel = isSaving
    ? 'Saving...'
    : saveSuccess
      ? 'Saved'
      : mode === 'create'
        ? 'Create agent'
        : 'Save changes'

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="agent-display-name">Display name</Label>
        <Input
          id="agent-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Support Agent"
          required
        />
        {mode === 'create' ? (
          <p className="text-xs text-muted-foreground">An internal ID will be generated automatically.</p>
        ) : null}
      </div>

      {mode === 'edit' && (
        <div className="space-y-2">
          <Label htmlFor="agent-id">Agent ID</Label>
          <Input id="agent-id" value={id} disabled />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="agent-model">Model override</Label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={usesDefaultModel}
                onChange={(event) => handleUsesDefaultModelChange(event.target.checked)}
                className={checkboxClassName}
              />
              Use workspace default model
            </label>
          </div>
          <Input
            id="agent-model"
            list="agent-models"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Select or type a model"
            disabled={usesDefaultModel}
          />
          {usesDefaultModel ? (
            <p className="text-xs text-muted-foreground">
              {defaultModel ? `Using ${defaultModel}` : 'No workspace default model is configured.'}
            </p>
          ) : null}
          <datalist id="agent-models">
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            {!hasCurrentModel && model ? <option value={model}>Current: {model}</option> : null}
          </datalist>
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-temperature">Temperature</Label>
          <Input
            id="agent-temperature"
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
            placeholder="0.2"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-description">Description</Label>
        <textarea
          id="agent-description"
          className="min-h-[96px] w-full rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Short description of the agent role."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-prompt">Prompt</Label>
        <textarea
          id="agent-prompt"
          className="min-h-[240px] w-full rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Define the system prompt for this agent..."
        />
      </div>

      <TooltipProvider delayDuration={200}>
        <div className="space-y-5 rounded-xl border border-border/60 bg-card/30 p-5">
          <div>
            <Label className="text-base">Capabilities</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Configure which tools, connectors and skills this agent can use.
            </p>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-1.5">
              <Label className="text-sm text-muted-foreground">Tools</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground/50 transition-colors hover:text-muted-foreground">
                    <Info size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[240px] text-xs leading-relaxed">
                  Built-in tools the agent can invoke during a conversation. These are provided by the platform and cannot be added or removed.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {OPENCODE_AGENT_TOOL_OPTIONS.map((tool) => {
                const checked = enabledTools.includes(tool.id)
                return (
                  <label
                    key={tool.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                      checked
                        ? 'border-primary/40 bg-primary/5 text-foreground'
                        : 'border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(tool.id)}
                      className={checkboxClassName}
                    />
                    <span>{tool.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-1.5">
              <Label className="text-sm text-muted-foreground">Connectors</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground/50 transition-colors hover:text-muted-foreground">
                    <Info size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[240px] text-xs leading-relaxed">
                  Built-in MCP connectors apply globally by type. Custom connectors are granted per configured connector across all workspaces, including service users.
                </TooltipContent>
              </Tooltip>
            </div>
            {connectors.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-sm text-muted-foreground/70">
                No connectors available.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {connectors.map((connector) => {
                  const checked = enabledMcpConnectorIds.includes(connector.id)
                  const metadata = connector.scope === 'type'
                    ? 'All workspaces with this connector type'
                    : `${connector.ownerSlug ?? 'Unknown workspace'}${connector.ownerKind === 'SERVICE' ? ' service workspace' : ''}${connector.enabled ? '' : ' · disabled'}`
                  return (
                    <label
                      key={connector.id}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                        checked
                          ? 'border-primary/40 bg-primary/5 text-foreground'
                          : 'border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMcpConnector(connector.id)}
                        className={checkboxClassName}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{connector.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {connector.type} · {metadata}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-1.5">
              <Label className="text-sm text-muted-foreground">Skills</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground/50 transition-colors hover:text-muted-foreground">
                    <Info size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[240px] text-xs leading-relaxed">
                  Skills are reusable prompt snippets the agent can load on demand. Create and manage skills from the Skills page.
                </TooltipContent>
              </Tooltip>
            </div>
            {skills.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-sm text-muted-foreground/70">
                No skills available.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {skills.map((skill) => {
                  const checked = enabledSkillIds.includes(skill.name)
                  return (
                    <label
                      key={skill.name}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                        checked
                          ? 'border-primary/40 bg-primary/5 text-foreground'
                          : 'border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(skill.name)}
                        className={checkboxClassName}
                      />
                      <span className="font-medium">{skill.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </TooltipProvider>

      {mode === 'edit' && (
        <div className="flex flex-col gap-3">
          <Label>Agent type</Label>
          <div
            role="switch"
            aria-checked={isPrimary}
            className="relative inline-grid h-10 grid-cols-2 rounded-full bg-muted p-1"
          >
            <span
              className={`
                absolute inset-y-1 w-[calc(50%-2px)] rounded-full bg-background shadow-sm transition-all duration-200 ease-in-out
                ${isPrimary ? 'left-[calc(50%+1px)]' : 'left-1'}
              `}
            />
            <button
              type="button"
              onClick={() => {}}
              disabled={!isPrimary || isSaving}
              className={`relative z-10 cursor-pointer px-5 text-sm font-medium transition-colors disabled:cursor-default ${!isPrimary ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              Secondary
            </button>
            <button
              type="button"
              onClick={handleSetPrimary}
              disabled={isPrimary || isSaving}
              className={`relative z-10 cursor-pointer px-5 text-sm font-medium transition-colors disabled:cursor-default ${isPrimary ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              Primary
            </button>
          </div>
        </div>
      )}

      {mode === 'create' && allowPrimarySelection && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(event) => setIsPrimary(event.target.checked)}
            className={checkboxClassName}
          />
          Set as primary
        </label>
      )}

      {saveError && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
          Error: {saveError}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border/40 pt-6">
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSaving} variant={saveSuccess ? 'secondary' : 'default'}>
            {saveLabel}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {cancelLabel}
            </Button>
          ) : null}
        </div>

        {mode === 'edit' && !isPrimary && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isSaving}
            className="text-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50"
          >
            Delete agent
          </button>
        )}
      </div>
    </form>
  )
}
