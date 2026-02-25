'use client'

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle,
  Circle,
  SpinnerGap,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getRequiredAgentIdsForTemplate } from '@/kickstart/required-agent-ids'
import type {
  KickstartApplyRequestPayload,
  KickstartStatus,
  KickstartTemplateDefinition,
  KickstartTemplateSummary,
  KickstartTemplatesResponse,
} from '@/kickstart/types'
import { cn } from '@/lib/utils'

type KickstartWizardProps = {
  slug: string
  initialStatus: KickstartStatus
}

type AgentOverride = {
  model?: string
  prompt?: string
  temperature?: number
}

type ModelOption = {
  id: string
  label: string
}

type ImportTemplateResult =
  | { ok: true; template: KickstartTemplateDefinition }
  | { ok: false; error: string }

const STEPS = [
  'Company details',
  'Template selection',
  'Agent selection',
  'Review and apply',
]

const IMPORT_TEMPLATE_ID = '__imported-template__'
const CORE_AGENT_PROMPT_OVERRIDE_BLOCKLIST = new Set(['assistant', 'knowledge-curator'])

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseImportedTemplate(
  value: unknown,
  knownAgentIds: ReadonlySet<string>
): ImportTemplateResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'Template JSON must be an object.' }
  }

  const allowedKeys = new Set([
    'id',
    'label',
    'description',
    'kbSkeleton',
    'agentsMdTemplate',
    'recommendedAgentIds',
    'agentOverrides',
    'order',
  ])

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `Unsupported template field: ${key}` }
    }
  }

  const requiredStringFieldEntries: Array<[string, unknown]> = [
    ['id', value.id],
    ['label', value.label],
    ['description', value.description],
    ['agentsMdTemplate', value.agentsMdTemplate],
  ]

  for (const [field, fieldValue] of requiredStringFieldEntries) {
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
      return { ok: false, error: `${field} must be a non-empty string.` }
    }
  }

  if (!Array.isArray(value.kbSkeleton) || value.kbSkeleton.length === 0) {
    return { ok: false, error: 'kbSkeleton must be a non-empty array.' }
  }

  for (const entry of value.kbSkeleton) {
    if (!isRecord(entry)) {
      return { ok: false, error: 'kbSkeleton entries must be objects.' }
    }

    if (entry.type !== 'dir' && entry.type !== 'file') {
      return { ok: false, error: 'kbSkeleton entry type must be "dir" or "file".' }
    }

    if (typeof entry.path !== 'string' || entry.path.trim().length === 0) {
      return { ok: false, error: 'kbSkeleton entry path must be a non-empty string.' }
    }

    if (entry.type === 'file' && typeof entry.content !== 'string') {
      return { ok: false, error: 'kbSkeleton file entry content must be a string.' }
    }
  }

  if (!Array.isArray(value.recommendedAgentIds) || value.recommendedAgentIds.length === 0) {
    return { ok: false, error: 'recommendedAgentIds must be a non-empty array.' }
  }

  const recommendedAgentIds: string[] = []
  const seenRecommended = new Set<string>()
  for (const agentIdValue of value.recommendedAgentIds) {
    if (typeof agentIdValue !== 'string' || agentIdValue.trim().length === 0) {
      return { ok: false, error: 'Each recommendedAgentId must be a non-empty string.' }
    }

    const agentId = agentIdValue.trim()
    if (!knownAgentIds.has(agentId)) {
      return { ok: false, error: `Unknown agent id in recommendedAgentIds: ${agentId}` }
    }

    if (!seenRecommended.has(agentId)) {
      seenRecommended.add(agentId)
      recommendedAgentIds.push(agentId)
    }
  }

  if (!isRecord(value.agentOverrides)) {
    return { ok: false, error: 'agentOverrides must be an object.' }
  }

  const agentOverrides: Record<string, { model?: string; prompt?: string }> = {}
  for (const [agentId, overrideValue] of Object.entries(value.agentOverrides)) {
    if (!knownAgentIds.has(agentId)) {
      return { ok: false, error: `Unknown agent id in agentOverrides: ${agentId}` }
    }

    if (!isRecord(overrideValue)) {
      return { ok: false, error: `agentOverrides.${agentId} must be an object.` }
    }

    const overrideKeys = Object.keys(overrideValue)
    if (overrideKeys.some((key) => key !== 'model' && key !== 'prompt')) {
      return {
        ok: false,
        error: `agentOverrides.${agentId} supports only "model" and "prompt".`,
      }
    }

    const model = overrideValue.model
    const prompt = overrideValue.prompt

    if (model !== undefined && (typeof model !== 'string' || model.trim().length === 0)) {
      return { ok: false, error: `agentOverrides.${agentId}.model must be a non-empty string.` }
    }

    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.trim().length === 0)) {
      return { ok: false, error: `agentOverrides.${agentId}.prompt must be a non-empty string.` }
    }

    if (prompt !== undefined && CORE_AGENT_PROMPT_OVERRIDE_BLOCKLIST.has(agentId)) {
      return {
        ok: false,
        error: `Prompt overrides are not allowed for core agent: ${agentId}`,
      }
    }

    if (model === undefined && prompt === undefined) {
      return {
        ok: false,
        error: `agentOverrides.${agentId} must define at least one field.`,
      }
    }

    agentOverrides[agentId] = {
      ...(model !== undefined ? { model: model.trim() } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
    }
  }

  const kbSkeleton = value.kbSkeleton.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    if (entry.type === 'dir') {
      return [
        {
          type: 'dir' as const,
          path: String(entry.path).trim(),
        },
      ]
    }

    return [
      {
        type: 'file' as const,
        path: String(entry.path).trim(),
        content: String(entry.content),
      },
    ]
  })

  const template: KickstartTemplateDefinition = {
    id: value.id.trim(),
    label: value.label.trim(),
    description: value.description.trim(),
    kbSkeleton,
    agentsMdTemplate: value.agentsMdTemplate,
    recommendedAgentIds,
    agentOverrides,
  }

  return { ok: true, template }
}

export function KickstartWizard({ slug, initialStatus }: KickstartWizardProps) {
  const router = useRouter()

  const [step, setStep] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isApplying, setIsApplying] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  const [catalog, setCatalog] = useState<KickstartTemplatesResponse | null>(null)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [companyName, setCompanyName] = useState('')
  const [companyDescription, setCompanyDescription] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [importedTemplate, setImportedTemplate] = useState<KickstartTemplateDefinition | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [agentOverrides, setAgentOverrides] = useState<Record<string, AgentOverride>>({})
  const importInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadCatalog() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const [templatesResponse, modelsResponse] = await Promise.all([
          fetch(`/api/u/${slug}/kickstart/templates`, {
            cache: 'no-store',
          }).catch(() => null),
          fetch(`/api/u/${slug}/agents/models`, {
            cache: 'no-store',
          }).catch(() => null),
        ])

        const response = templatesResponse
        if (!response) {
          setLoadError('Failed to load kickstart templates')
          return
        }

        const data = (await response.json().catch(() => null)) as KickstartTemplatesResponse | { error?: string } | null
        if (cancelled) return

        if (!response.ok || !data || !('templates' in data)) {
          setLoadError((data && 'error' in data && data.error) || 'Failed to load kickstart templates')
          return
        }

        setCatalog(data)

        if (modelsResponse?.ok) {
          const modelData = (await modelsResponse.json().catch(() => null)) as
            | { models?: ModelOption[] }
            | null
          setModelOptions(modelData?.models ?? [])
        } else {
          setModelOptions([])
        }

        const firstTemplate = data.templates[0]
        if (!firstTemplate) {
          setLoadError('No kickstart templates available')
          return
        }

        setSelectedTemplateId(firstTemplate.id)
        setSelectedAgentIds(
          unique([
            ...getRequiredAgentIdsForTemplate(firstTemplate.id),
            ...firstTemplate.recommendedAgentIds,
          ])
        )
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadCatalog().catch(() => {
      if (!cancelled) {
        setIsLoading(false)
        setLoadError('Failed to load kickstart templates')
      }
    })

    return () => {
      cancelled = true
    }
  }, [slug])

  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId === IMPORT_TEMPLATE_ID) {
      if (!importedTemplate) return null

      const importedTemplateSummary: KickstartTemplateSummary = {
        id: importedTemplate.id,
        label: importedTemplate.label,
        description: importedTemplate.description,
        recommendedAgentIds: importedTemplate.recommendedAgentIds,
        agentOverrides: importedTemplate.agentOverrides,
      }

      return importedTemplateSummary
    }

    if (!catalog) return null
    return catalog.templates.find((template) => template.id === selectedTemplateId) ?? null
  }, [catalog, importedTemplate, selectedTemplateId])

  const agentById = useMemo(() => {
    return new Map((catalog?.agents ?? []).map((agent) => [agent.id, agent]))
  }, [catalog])

  const modelOptionById = useMemo(
    () => new Map(modelOptions.map((option) => [option.id, option])),
    [modelOptions]
  )

  const agentOrder = useMemo(() => {
    return new Map((catalog?.agents ?? []).map((agent, index) => [agent.id, index]))
  }, [catalog])

  const selectedAgents = useMemo(
    () =>
      selectedAgentIds
        .map((agentId) => agentById.get(agentId))
        .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent)),
    [selectedAgentIds, agentById]
  )

  const requiredIds = useMemo(
    () => (selectedTemplate ? getRequiredAgentIdsForTemplate(selectedTemplate.id) : []),
    [selectedTemplate]
  )

  const stepOneReady = companyName.trim().length > 0 && companyDescription.trim().length > 0
  const stepTwoReady = Boolean(selectedTemplate)
  const stepThreeReady =
    selectedAgentIds.length > 0 &&
    requiredIds.every((requiredId) => selectedAgentIds.includes(requiredId))

  function isStepReady(stepNumber: number): boolean {
    if (stepNumber === 1) return stepOneReady
    if (stepNumber === 2) return stepTwoReady
    if (stepNumber === 3) return stepThreeReady
    return true
  }

  function resolveAgentValue(agentId: string): {
    model: string
    prompt: string
    temperature: number
  } {
    const agent = agentById.get(agentId)
    if (!agent) {
      return {
        model: '',
        prompt: '',
        temperature: 0.2,
      }
    }

    const overrides = agentOverrides[agentId]

    return {
      model:
        overrides?.model ??
        selectedTemplate?.agentOverrides[agentId]?.model ??
        agent.recommendedModel,
      prompt:
        overrides?.prompt ??
        selectedTemplate?.agentOverrides[agentId]?.prompt ??
        agent.systemPrompt,
      temperature: overrides?.temperature ?? agent.temperature,
    }
  }

  function setAgentOverride(agentId: string, patch: AgentOverride) {
    setAgentOverrides((current) => ({
      ...current,
      [agentId]: {
        ...current[agentId],
        ...patch,
      },
    }))
  }

  function handleTemplateChange(templateId: string) {
    if (!catalog) return
    const template = catalog.templates.find((entry) => entry.id === templateId)
    if (!template) return

    setSelectedTemplateId(template.id)
    setSelectedAgentIds(
      unique([
        ...getRequiredAgentIdsForTemplate(template.id),
        ...template.recommendedAgentIds,
      ])
    )
    setApplyError(null)
    setImportError(null)
  }

  function handleImportButtonClick() {
    importInputRef.current?.click()
  }

  async function handleImportTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !catalog) {
      return
    }

    const knownAgentIds = new Set((catalog.agents ?? []).map((agent) => agent.id))

    let rawContent = ''
    try {
      rawContent = await file.text()
    } catch {
      setImportError('Failed to read selected template file.')
      return
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawContent)
    } catch {
      setImportError('Invalid JSON file.')
      return
    }

    const parsedTemplate = parseImportedTemplate(parsedJson, knownAgentIds)
    if (!parsedTemplate.ok) {
      setImportError(parsedTemplate.error)
      return
    }

    setImportedTemplate(parsedTemplate.template)
    setSelectedTemplateId(IMPORT_TEMPLATE_ID)
    setSelectedAgentIds(
      unique([
        ...getRequiredAgentIdsForTemplate(parsedTemplate.template.id),
        ...parsedTemplate.template.recommendedAgentIds,
      ])
    )
    setApplyError(null)
    setImportError(null)
  }

  function toggleAgent(agentId: string) {
    if (!selectedTemplate) return

    const required = getRequiredAgentIdsForTemplate(selectedTemplate.id)
    if (required.includes(agentId)) return

    setSelectedAgentIds((current) => {
      if (current.includes(agentId)) {
        return current.filter((id) => id !== agentId)
      }

      const next = [...current, agentId]
      return next.sort(
        (left, right) =>
          (agentOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (agentOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      )
    })
  }

  async function handleApply() {
    if (!selectedTemplate) return

    setApplyError(null)
    setIsApplying(true)

    try {
      const payload: KickstartApplyRequestPayload = {
        companyName: companyName.trim(),
        companyDescription: companyDescription.trim(),
        agents: selectedAgentIds.map((agentId) => {
          const resolved = resolveAgentValue(agentId)
          return {
            id: agentId,
            model: resolved.model,
            prompt: resolved.prompt,
            temperature: resolved.temperature,
          }
        }),
        ...(selectedTemplateId === IMPORT_TEMPLATE_ID && importedTemplate
          ? { template: importedTemplate }
          : { templateId: selectedTemplate.id }),
      }

      const response = await fetch(`/api/u/${slug}/kickstart/apply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = (await response.json().catch(() => null)) as {
        error?: string
        message?: string
      } | null

      if (!response.ok) {
        setApplyError(data?.message ?? data?.error ?? 'Kickstart apply failed')
        return
      }

      router.push(`/u/${slug}?setup=completed`)
    } catch {
      setApplyError('Kickstart apply failed')
    } finally {
      setIsApplying(false)
    }
  }

  if (isLoading) {
    return (
      <div className="glass-panel rounded-3xl px-8 py-16 text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Loading kickstart templates...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="glass-panel rounded-3xl border-destructive/25 px-8 py-12">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-destructive">
          Kickstart unavailable
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {initialStatus === 'setup_in_progress' && (
        <div className="glass-panel rounded-2xl border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
          Another setup operation is currently running. You can still review this wizard, but apply may return a conflict until the current run finishes.
        </div>
      )}

      <section className="glass-panel rounded-3xl p-6 sm:p-8">
        <div className="mb-8 grid gap-3 sm:grid-cols-4">
          {STEPS.map((label, index) => {
            const itemStep = index + 1
            const completed = step > itemStep
            const active = step === itemStep

            return (
              <div
                key={label}
                className={cn(
                  'rounded-xl border px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : completed
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                      : 'border-border/60 bg-background/40 text-muted-foreground'
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  {completed ? (
                    <CheckCircle size={16} weight="fill" />
                  ) : (
                    <Circle size={16} weight={active ? 'fill' : 'regular'} />
                  )}
                  <span className="text-xs uppercase tracking-wide">Step {itemStep}</span>
                </div>
                <p className="text-sm font-medium">{label}</p>
              </div>
            )
          })}
        </div>

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl">Company details</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This context is used to render the initial KB and baseline prompts.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="company-name">Company name</Label>
              <Input
                id="company-name"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Acme Labs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company-description">Short description</Label>
              <textarea
                id="company-description"
                className="min-h-[120px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30"
                value={companyDescription}
                onChange={(event) => setCompanyDescription(event.target.value)}
                placeholder="What your company does, who it serves, and what matters most."
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl">Template selection</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick the baseline structure that best matches your operating model.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(catalog?.templates ?? []).map((template) => {
                const selected = selectedTemplateId === template.id
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleTemplateChange(template.id)}
                    className={cn(
                      'rounded-2xl border p-4 text-left transition-colors',
                      selected
                        ? 'border-primary/55 bg-primary/10'
                        : 'border-border/60 bg-background/40 hover:border-border'
                    )}
                  >
                    <p className="font-medium text-foreground">{template.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Recommended agents: {template.recommendedAgentIds.length}
                    </p>
                  </button>
                )
              })}

              <button
                type="button"
                onClick={handleImportButtonClick}
                className={cn(
                  'rounded-2xl border p-4 text-left transition-colors',
                  selectedTemplateId === IMPORT_TEMPLATE_ID
                    ? 'border-primary/55 bg-primary/10'
                    : 'border-border/60 bg-background/40 hover:border-border'
                )}
              >
                <p className="font-medium text-foreground">Import</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a custom template JSON from your computer.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {importedTemplate
                    ? `Loaded: ${importedTemplate.label}`
                    : 'Template file must follow kickstart template definition schema.'}
                </p>
              </button>
            </div>

            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportTemplate}
            />

            {importError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {importError}
              </div>
            )}

            {selectedTemplateId === IMPORT_TEMPLATE_ID && importedTemplate && (
              <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                Imported template ID: <span className="font-medium text-foreground">{importedTemplate.id}</span>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl">Agent selection</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start from template recommendations, then tune the final set.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(catalog?.agents ?? []).map((agent) => {
                const selected = selectedAgentIds.includes(agent.id)
                const required = requiredIds.includes(agent.id)
                const recommended = selectedTemplate?.recommendedAgentIds.includes(agent.id) ?? false

                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleAgent(agent.id)}
                    className={cn(
                      'rounded-2xl border p-4 text-left transition-colors',
                      selected
                        ? 'border-primary/55 bg-primary/10'
                        : 'border-border/60 bg-background/40 hover:border-border',
                      required && 'cursor-default'
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground">{agent.displayName}</p>
                      <div className="flex items-center gap-2 text-xs">
                        {required && (
                          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-foreground">
                            Required
                          </span>
                        )}
                        {recommended && (
                          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-primary">
                            Recommended
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{agent.description}</p>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl">Review and apply</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Finalize per-agent model and prompt defaults before generating KB and config.
              </p>
            </div>

            <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-sm">
              <p>
                <span className="font-medium text-foreground">Company:</span>{' '}
                <span className="text-muted-foreground">{companyName}</span>
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">Template:</span>{' '}
                <span className="text-muted-foreground">{selectedTemplate?.label ?? 'None'}</span>
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">Agents selected:</span>{' '}
                <span className="text-muted-foreground">{selectedAgents.length}</span>
              </p>
            </div>

            <div className="space-y-4">
              {selectedAgents.map((agent) => {
                const resolved = resolveAgentValue(agent.id)
                return (
                  <div
                    key={agent.id}
                    className="rounded-2xl border border-border/60 bg-background/40 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{agent.displayName}</p>
                        <p className="text-xs text-muted-foreground">{agent.id}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Model</Label>
                        <Input
                          list="kickstart-model-options"
                          value={resolved.model}
                          onChange={(event) => {
                            setAgentOverride(agent.id, {
                              model: event.target.value,
                            })
                          }}
                          placeholder="provider/model"
                        />
                        {resolved.model.trim() ? (
                          modelOptions.length > 0 ? (
                            modelOptionById.has(resolved.model.trim()) ? (
                              <p className="text-xs text-muted-foreground">
                                {modelOptionById.get(resolved.model.trim())?.label}
                              </p>
                            ) : (
                              <p className="text-xs text-amber-700">
                                No exact match found in models.dev catalog.
                              </p>
                            )
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              models.dev catalog unavailable; validate manually.
                            </p>
                          )
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Search {modelOptions.length} models from models.dev.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Temperature</Label>
                        <Input
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={String(resolved.temperature)}
                          onChange={(event) => {
                            if (!event.target.value) {
                              setAgentOverride(agent.id, { temperature: undefined })
                              return
                            }

                            const parsed = Number(event.target.value)
                            if (Number.isFinite(parsed)) {
                              setAgentOverride(agent.id, { temperature: parsed })
                            }
                          }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <Label>System prompt</Label>
                      <textarea
                        className="min-h-[150px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30"
                        value={resolved.prompt}
                        onChange={(event) => {
                          setAgentOverride(agent.id, {
                            prompt: event.target.value,
                          })
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {applyError && (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {applyError}
          </div>
        )}

        <datalist id="kickstart-model-options">
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </datalist>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            disabled={step === 1 || isApplying}
          >
            Back
          </Button>

          {step < 4 ? (
            <Button
              type="button"
              onClick={() => setStep((current) => Math.min(4, current + 1))}
              disabled={!isStepReady(step) || isApplying}
            >
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleApply}
              disabled={!isStepReady(3) || isApplying}
            >
              {isApplying ? (
                <>
                  <SpinnerGap size={16} className="animate-spin" />
                  Applying
                </>
              ) : (
                'Apply kickstart'
              )}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
