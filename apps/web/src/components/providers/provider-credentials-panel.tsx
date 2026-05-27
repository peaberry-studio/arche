'use client'

import { useCallback, useEffect, useState } from 'react'

import { getTeamErrorMessage } from '@/components/team/error-messages'
import type { TeamProviderStatus } from '@/components/team/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getProviderLabel } from '@/lib/providers/catalog'
import type { ProviderId } from '@/lib/providers/types'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'

type ProviderCredentialsPanelProps = {
  slug: string
  title?: string
  description?: string
  showHeader?: boolean
}

type OllamaFormState = {
  baseUrl: string
  mode: 'local' | 'remote'
  token: string
}

const DEFAULT_OLLAMA_FORM: OllamaFormState = {
  baseUrl: '',
  mode: 'local',
  token: '',
}

async function fetchProviders(slug: string): Promise<{
  error?: string
  ok: boolean
  providers: TeamProviderStatus[]
}> {
  const response = await fetch(`/api/u/${slug}/providers`, {
    cache: 'no-store',
  })
  const data = (await response.json().catch(() => null)) as
    | { providers?: TeamProviderStatus[]; error?: string }
    | null

  if (!response.ok) {
    return {
      error: getTeamErrorMessage(data?.error ?? 'load_failed'),
      ok: false,
      providers: [],
    }
  }

  return {
    ok: true,
    providers: data?.providers ?? [],
  }
}

export function ProviderCredentialsPanel({
  slug,
  title = 'Provider credentials',
  description = 'Configure API credentials for the current workspace user.',
  showHeader = true,
}: ProviderCredentialsPanelProps) {
  const [providers, setProviders] = useState<TeamProviderStatus[]>([])
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({})
  const [ollamaForms, setOllamaForms] = useState<Record<string, OllamaFormState>>({})
  const [providerBusy, setProviderBusy] = useState<Record<string, boolean>>({})
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({})
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [providerError, setProviderError] = useState<string | null>(null)

  const loadProviders = useCallback(async () => {
    setIsLoadingProviders(true)
    setProviderError(null)

    try {
      const data = await fetchProviders(slug)

      if (!data.ok) {
        setProviderError(data.error ?? getTeamErrorMessage('load_failed'))
        return
      }

      setProviders(data.providers)
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setIsLoadingProviders(false)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialProviders() {
      try {
        const data = await fetchProviders(slug)
        if (cancelled) return

        if (!data.ok) {
          setProviderError(data.error ?? getTeamErrorMessage('load_failed'))
          return
        }

        setProviders(data.providers)
        setProviderError(null)
      } catch {
        if (!cancelled) {
          setProviderError(getTeamErrorMessage('network_error'))
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProviders(false)
        }
      }
    }

    void loadInitialProviders()

    return () => {
      cancelled = true
    }
  }, [slug])

  function getOllamaForm(providerId: ProviderId): OllamaFormState {
    return ollamaForms[providerId] ?? DEFAULT_OLLAMA_FORM
  }

  function updateOllamaForm(providerId: ProviderId, patch: Partial<OllamaFormState>) {
    setOllamaForms((current) => ({
      ...current,
      [providerId]: { ...DEFAULT_OLLAMA_FORM, ...current[providerId], ...patch },
    }))
  }

  function clearProviderInputs(providerId: ProviderId) {
    setProviderApiKeys((current) => ({ ...current, [providerId]: '' }))
    setOllamaForms((current) => ({ ...current, [providerId]: DEFAULT_OLLAMA_FORM }))
  }

  function canSaveProvider(providerId: ProviderId): boolean {
    if (providerId !== 'ollama') {
      return Boolean(providerApiKeys[providerId]?.trim())
    }

    const form = getOllamaForm(providerId)
    return form.mode === 'local' || (Boolean(form.baseUrl.trim()) && Boolean(form.token.trim()))
  }

  function getOllamaSaveBody(providerId: ProviderId): Record<string, string> {
    const form = getOllamaForm(providerId)
    if (form.mode === 'local') {
      const baseUrl = form.baseUrl.trim()
      return baseUrl ? { baseUrl, mode: 'local' } : { mode: 'local' }
    }

    return {
      baseUrl: form.baseUrl.trim(),
      mode: 'remote',
      token: form.token.trim(),
    }
  }

  async function saveProviderRequest(providerId: ProviderId, body: Record<string, string | boolean>) {
    return fetch(`/api/u/${slug}/providers/${providerId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function handleSaveProvider(providerId: ProviderId) {
    const apiKey = providerApiKeys[providerId]?.trim() ?? ''
    if (providerId !== 'ollama' && !apiKey) return
    if (providerId === 'ollama' && !canSaveProvider(providerId)) return

    setProviderBusy((current) => ({ ...current, [providerId]: true }))
    setProviderError(null)

    try {
      const response = await saveProviderRequest(
        providerId,
        providerId === 'ollama' ? getOllamaSaveBody(providerId) : { apiKey },
      )
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'provider_update_failed'))
        return
      }

      clearProviderInputs(providerId)
      setExpandedProviders((current) => ({ ...current, [providerId]: false }))
      await loadProviders()
      notifyWorkspaceConfigChanged()
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setProviderBusy((current) => ({ ...current, [providerId]: false }))
    }
  }

  async function handleDisableProvider(providerId: ProviderId) {
    setProviderBusy((current) => ({ ...current, [providerId]: true }))
    setProviderError(null)

    try {
      const response = await fetch(`/api/u/${slug}/providers/${providerId}`, {
        method: 'DELETE',
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'provider_disable_failed'))
        return
      }

      setExpandedProviders((current) => ({ ...current, [providerId]: false }))
      await loadProviders()
      notifyWorkspaceConfigChanged()
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setProviderBusy((current) => ({ ...current, [providerId]: false }))
    }
  }

  async function handleRefreshOllama(providerId: ProviderId) {
    setProviderBusy((current) => ({ ...current, [providerId]: true }))
    setProviderError(null)

    try {
      const response = await saveProviderRequest(providerId, { refresh: true })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'provider_update_failed'))
        return
      }

      await loadProviders()
      notifyWorkspaceConfigChanged()
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setProviderBusy((current) => ({ ...current, [providerId]: false }))
    }
  }

  function renderOllamaDetails(provider: TeamProviderStatus) {
    if (provider.providerId !== 'ollama' || !provider.details) return null

    const modeLabel = provider.details.mode === 'local' ? 'Local' : 'Remote'
    const modelLabels = provider.details.models.map((model) => model.name || model.id)

    return (
      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
        <p>{modeLabel}: {provider.details.baseUrl}</p>
        <p>
          {modelLabels.length} model{modelLabels.length === 1 ? '' : 's'} discovered
          {modelLabels.length > 0 ? `: ${modelLabels.slice(0, 4).join(', ')}` : ''}
        </p>
      </div>
    )
  }

  function renderCredentialForm(provider: TeamProviderStatus, placeholder: string, actionLabel: string) {
    const isBusy = Boolean(providerBusy[provider.providerId])
    const canSave = canSaveProvider(provider.providerId)

    if (provider.providerId === 'ollama') {
      const form = getOllamaForm(provider.providerId)

      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={form.mode === 'local' ? 'default' : 'outline'}
              disabled={isBusy}
              onClick={() => updateOllamaForm(provider.providerId, { mode: 'local' })}
            >
              Local
            </Button>
            <Button
              type="button"
              size="sm"
              variant={form.mode === 'remote' ? 'default' : 'outline'}
              disabled={isBusy}
              onClick={() => updateOllamaForm(provider.providerId, { mode: 'remote' })}
            >
              Remote
            </Button>
          </div>

          {form.mode === 'local' ? (
            <div className="space-y-2">
              <Input
                value={form.baseUrl}
                onChange={(event) => updateOllamaForm(provider.providerId, { baseUrl: event.target.value })}
                placeholder="Optional local URL, auto-detect if blank"
              />
              <p className="text-xs text-muted-foreground">Detects Ollama from the Arche server and saves only when models can be listed.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={form.baseUrl}
                onChange={(event) => updateOllamaForm(provider.providerId, { baseUrl: event.target.value })}
                placeholder="https://ollama.example.com/v1"
              />
              <Input
                type="password"
                value={form.token}
                onChange={(event) => updateOllamaForm(provider.providerId, { token: event.target.value })}
                placeholder="Bearer token"
              />
            </div>
          )}

          <Button
            type="button"
            size="sm"
            disabled={isBusy || !canSave}
            onClick={() => handleSaveProvider(provider.providerId)}
          >
            {isBusy ? 'Saving...' : form.mode === 'local' ? 'Detect Ollama' : actionLabel}
          </Button>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="password"
          value={providerApiKeys[provider.providerId] ?? ''}
          onChange={(event) =>
            setProviderApiKeys((current) => ({
              ...current,
              [provider.providerId]: event.target.value,
            }))
          }
          placeholder={placeholder}
        />
        <Button
          type="button"
          size="sm"
          disabled={isBusy || !canSave}
          onClick={() => handleSaveProvider(provider.providerId)}
        >
          {isBusy ? 'Saving...' : actionLabel}
        </Button>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      {showHeader ? (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          {isLoadingProviders ? <span className="text-xs text-muted-foreground">Loading...</span> : null}
        </div>
      ) : null}

      {providerError ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {providerError}
        </p>
      ) : null}

      <div className="space-y-3">
        {providers.map((provider) => {
          const isBusy = Boolean(providerBusy[provider.providerId])
          const isExpanded = Boolean(expandedProviders[provider.providerId])
          const isInherited = provider.status === 'enabled' && provider.source === 'organization'
          const isInactive = provider.status === 'missing' || provider.status === 'disabled'
          const rotateLabel = provider.source === 'user' ? 'Rotate override' : 'Rotate key'
          const removeLabel = provider.source === 'user' ? 'Remove override' : 'Disable'

          if (isInactive && !isExpanded) {
            return (
              <div key={provider.providerId} className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                  <p className="text-xs text-muted-foreground">No credential set</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setExpandedProviders((current) => ({ ...current, [provider.providerId]: true }))
                  }
                >
                  Enable
                </Button>
              </div>
            )
          }

          if (isInherited && !isExpanded) {
            return (
              <div key={provider.providerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                    {provider.version ? (
                      <span className="text-xs text-muted-foreground">v{provider.version}</span>
                    ) : null}
                    <Badge variant="secondary">Inherited</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Inherited from organization{provider.overrideStatus === 'disabled' ? '; user override removed' : ''}
                  </p>
                  {renderOllamaDetails(provider)}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() =>
                    setExpandedProviders((current) => ({ ...current, [provider.providerId]: true }))
                  }
                >
                  Set user override
                </Button>
              </div>
            )
          }

          if (isInactive && isExpanded) {
            return (
              <div key={provider.providerId} className="space-y-3 rounded-xl border border-border/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                    <p className="text-xs text-muted-foreground">No credential set</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => {
                      setExpandedProviders((current) => ({ ...current, [provider.providerId]: false }))
                      clearProviderInputs(provider.providerId)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                {renderCredentialForm(provider, 'Paste API key', 'Set key')}
              </div>
            )
          }

          if (isInherited && isExpanded) {
            return (
              <div key={provider.providerId} className="space-y-3 rounded-xl border border-border/60 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                      {provider.version ? (
                        <span className="text-xs text-muted-foreground">v{provider.version}</span>
                      ) : null}
                      <Badge variant="secondary">Inherited</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Set a user override for this workspace.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => {
                      setExpandedProviders((current) => ({ ...current, [provider.providerId]: false }))
                      clearProviderInputs(provider.providerId)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                {renderCredentialForm(provider, 'Paste user override API key', 'Set user override')}
              </div>
            )
          }

          if (!isExpanded) {
            return (
              <div key={provider.providerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                    {provider.version ? (
                      <span className="text-xs text-muted-foreground">v{provider.version}</span>
                    ) : null}
                    <Badge variant="default">User override</Badge>
                  </div>
                  {renderOllamaDetails(provider)}
                </div>
                <div className="flex items-center gap-2">
                  {provider.providerId === 'ollama' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => handleRefreshOllama(provider.providerId)}
                    >
                      {isBusy ? 'Refreshing...' : 'Refresh Models'}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() =>
                      setExpandedProviders((current) => ({ ...current, [provider.providerId]: true }))
                    }
                  >
                    {rotateLabel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => handleDisableProvider(provider.providerId)}
                  >
                    {isBusy ? 'Removing...' : removeLabel}
                  </Button>
                </div>
              </div>
            )
          }

          return (
            <div key={provider.providerId} className="space-y-3 rounded-xl border border-border/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                  {provider.version ? (
                    <span className="text-xs text-muted-foreground">v{provider.version}</span>
                  ) : null}
                  <Badge variant="default">User override</Badge>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => {
                    setExpandedProviders((current) => ({ ...current, [provider.providerId]: false }))
                    clearProviderInputs(provider.providerId)
                  }}
                >
                  Cancel
                </Button>
              </div>
              {renderCredentialForm(provider, 'Paste replacement API key', rotateLabel)}
            </div>
          )
        })}
      </div>
    </section>
  )
}
