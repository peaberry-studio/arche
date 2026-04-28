'use client'

import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'
import { cn } from '@/lib/utils'

type SkillFormProps = {
  cancelLabel?: string
  mode: 'create' | 'edit'
  onCancel?: () => void
  onDeleted?: (result: { name: string }) => void | Promise<void>
  onSaved?: (result: { mode: 'create' | 'edit'; name: string }) => void | Promise<void>
  skillName?: string
  slug: string
}

type SkillDetailResponse = {
  hash?: string | null
  skill?: {
    assignedAgentIds: string[]
    body: string
    description: string
    hasResources: boolean
    name: string
    resourcePaths: string[]
  }
  error?: string
}

const TEXTAREA_CLASS_NAME =
  'min-h-[120px] w-full rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30'

export function SkillForm({
  slug,
  mode,
  skillName,
  cancelLabel = 'Cancel',
  onCancel,
  onDeleted,
  onSaved,
}: SkillFormProps) {
  const { agents, isLoading: isLoadingAgents, loadError: agentsLoadError } = useAgentsCatalog(slug)

  const [name, setName] = useState(skillName ?? '')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([])
  const [resourcePaths, setResourcePaths] = useState<string[]>([])
  const [hash, setHash] = useState<string | null>()
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (mode === 'edit' && skillName) {
      setIsLoading(true)
      setLoadError(null)

      fetch(`/api/u/${slug}/skills/${skillName}`, { cache: 'no-store' })
        .then(async (response) => {
          const data = (await response.json().catch(() => null)) as SkillDetailResponse | null
          if (!response.ok || !data?.skill) {
            setLoadError(data?.error ?? 'load_failed')
            return
          }

          setName(data.skill.name)
          setDescription(data.skill.description)
          setBody(data.skill.body)
          setAssignedAgentIds(data.skill.assignedAgentIds)
          setResourcePaths(data.skill.resourcePaths)
          setHash(data.hash)
        })
        .catch(() => setLoadError('network_error'))
        .finally(() => setIsLoading(false))

      return
    }

    fetch(`/api/u/${slug}/skills`, { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { hash?: string | null } | null
        if (response.ok) {
          setHash(data?.hash)
        }
      })
      .catch(() => {})
  }, [mode, skillName, slug])

  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => {
      if (left.isPrimary && !right.isPrimary) return -1
      if (!left.isPrimary && right.isPrimary) return 1
      return left.displayName.localeCompare(right.displayName)
    }),
    [agents]
  )

  const hasResources = resourcePaths.length > 0

  function toggleAssignedAgent(agentId: string) {
    setAssignedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((entry) => entry !== agentId)
        : [...current, agentId]
    )
  }

  async function handleDelete() {
    if (!skillName) return
    const confirmed = window.confirm(`Delete the skill "${skillName}"?`)
    if (!confirmed) return

    setSaveError(null)
    setIsSaving(true)

    try {
      const response = await fetch(`/api/u/${slug}/skills/${skillName}`, {
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
      await onDeleted?.({ name: skillName })
    } catch {
      setSaveError('network_error')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    const normalizedName = name.trim()
    const normalizedDescription = description.trim()
    if (!normalizedName) {
      setSaveError('Skill name is required.')
      return
    }
    if (!normalizedDescription) {
      setSaveError('Description is required.')
      return
    }

    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      if (mode === 'create') {
        const response = await fetch(`/api/u/${slug}/skills`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: normalizedName,
            description: normalizedDescription,
            body,
            assignedAgentIds,
            expectedHash: hash,
          }),
        })
        const data = (await response.json().catch(() => null)) as { error?: string; hash?: string | null } | null
        if (!response.ok) {
          setSaveError(data?.error ?? 'create_failed')
          return
        }

        setHash(data?.hash)
        setSaveSuccess(true)
        notifyWorkspaceConfigChanged()
        await onSaved?.({ name: normalizedName, mode })
        setTimeout(() => setSaveSuccess(false), 2000)
        return
      }

      const response = await fetch(`/api/u/${slug}/skills/${skillName}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: normalizedDescription,
          body,
          assignedAgentIds,
          expectedHash: hash,
        }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string; hash?: string | null } | null
      if (!response.ok) {
        setSaveError(data?.error ?? 'update_failed')
        return
      }

      setHash(data?.hash)
      setSaveSuccess(true)
      notifyWorkspaceConfigChanged()
      await onSaved?.({ name: skillName ?? normalizedName, mode })
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
          Loading skill...
        </div>
      </div>
    )
  }

  if (loadError || agentsLoadError) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
        Failed to load: {loadError ?? agentsLoadError}
      </div>
    )
  }

  const saveLabel = isSaving
    ? 'Saving...'
    : saveSuccess
      ? 'Saved'
      : mode === 'create'
        ? 'Create skill'
        : 'Save changes'

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="skill-name">Skill name</Label>
        <Input
          id="skill-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="pdf-processing"
          disabled={mode === 'edit'}
          required
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, numbers, and hyphens only. This identifier is immutable after creation.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="skill-description">Description</Label>
        <textarea
          id="skill-description"
          className={cn(TEXTAREA_CLASS_NAME, 'min-h-[96px]')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe what the skill does and when an agent should use it."
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="skill-body">SKILL.md body</Label>
        <textarea
          id="skill-body"
          className={cn(TEXTAREA_CLASS_NAME, 'min-h-[320px]')}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="# When to use this skill\n\nExplain the workflow and important constraints..."
        />
      </div>

      {hasResources ? (
        <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">
          This skill includes {resourcePaths.length} bundled file{resourcePaths.length === 1 ? '' : 's'}.
          Edit them by exporting the skill, changing the bundle locally, and importing it again.
        </div>
      ) : null}

      <div className="space-y-3">
        <Label>Assigned agents</Label>
        <p className="text-xs text-muted-foreground">
          Choose which agents can use this skill by default.
        </p>

        {isLoadingAgents ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 p-3 text-sm text-muted-foreground">
            <SpinnerGap size={14} className="animate-spin" />
            Loading agents...
          </div>
        ) : sortedAgents.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card/50 p-3 text-sm text-muted-foreground">
            No agents available.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {sortedAgents.map((agent) => {
              const checked = assignedAgentIds.includes(agent.id)
              return (
                <label
                  key={agent.id}
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
                    onChange={() => toggleAssignedAgent(agent.id)}
                    className="h-4 w-4 rounded border border-border/70 bg-card/70 accent-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <span className="font-medium">{agent.displayName}</span>
                  {agent.isPrimary ? <span className="text-xs">(Primary)</span> : null}
                </label>
              )
            })}
          </div>
        )}
      </div>

      {saveError ? (
        <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
          Error: {saveError}
        </div>
      ) : null}

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

        {mode === 'edit' ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={isSaving}
            className="text-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50"
          >
            Delete skill
          </button>
        ) : null}
      </div>
    </form>
  )
}
