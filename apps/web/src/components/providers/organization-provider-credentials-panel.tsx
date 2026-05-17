'use client'

import { useCallback, useEffect, useState } from 'react'

import { getTeamErrorMessage } from '@/components/team/error-messages'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getProviderLabel } from '@/lib/providers/catalog'
import type { ProviderId } from '@/lib/providers/types'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'

type OrganizationProviderStatus = 'enabled' | 'disabled' | 'missing'

type OrganizationProvider = {
  providerId: ProviderId
  status: OrganizationProviderStatus
  type?: string
  version?: number
  lastUsedAt?: string | null
}

type OrganizationProviderCredentialsPanelProps = {
  slug: string
}

async function fetchOrganizationProviders(slug: string): Promise<{
  error?: string
  ok: boolean
  providers: OrganizationProvider[]
}> {
  const response = await fetch(`/api/u/${slug}/organization-providers`, { cache: 'no-store' })
  const data = (await response.json().catch(() => null)) as
    | { providers?: OrganizationProvider[]; error?: string }
    | null

  if (!response.ok) {
    return {
      error: getTeamErrorMessage(data?.error ?? 'load_failed'),
      ok: false,
      providers: [],
    }
  }

  return { ok: true, providers: data?.providers ?? [] }
}

export function OrganizationProviderCredentialsPanel({ slug }: OrganizationProviderCredentialsPanelProps) {
  const [providers, setProviders] = useState<OrganizationProvider[]>([])
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await fetchOrganizationProviders(slug)
      if (!result.ok) {
        setError(result.error ?? getTeamErrorMessage('load_failed'))
        return
      }

      setProviders(result.providers)
    } catch {
      setError(getTeamErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialProviders() {
      try {
        const result = await fetchOrganizationProviders(slug)
        if (cancelled) return

        if (!result.ok) {
          setError(result.error ?? getTeamErrorMessage('load_failed'))
          return
        }

        setProviders(result.providers)
      } catch {
        if (!cancelled) {
          setError(getTeamErrorMessage('network_error'))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialProviders()

    return () => {
      cancelled = true
    }
  }, [slug])

  async function handleSave(providerId: ProviderId) {
    const apiKey = apiKeys[providerId]?.trim() ?? ''
    if (!apiKey) return

    setBusy((current) => ({ ...current, [providerId]: true }))
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/organization-providers/${providerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setError(getTeamErrorMessage(data?.error ?? 'provider_update_failed'))
        return
      }

      setApiKeys((current) => ({ ...current, [providerId]: '' }))
      setExpanded((current) => ({ ...current, [providerId]: false }))
      await loadProviders()
      notifyWorkspaceConfigChanged()
    } catch {
      setError(getTeamErrorMessage('network_error'))
    } finally {
      setBusy((current) => ({ ...current, [providerId]: false }))
    }
  }

  async function handleDisable(providerId: ProviderId) {
    setBusy((current) => ({ ...current, [providerId]: true }))
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/organization-providers/${providerId}`, { method: 'DELETE' })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setError(getTeamErrorMessage(data?.error ?? 'provider_disable_failed'))
        return
      }

      setExpanded((current) => ({ ...current, [providerId]: false }))
      await loadProviders()
      notifyWorkspaceConfigChanged()
    } catch {
      setError(getTeamErrorMessage('network_error'))
    } finally {
      setBusy((current) => ({ ...current, [providerId]: false }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Credentials set here are inherited by every user without a user override.</p>
        {isLoading ? <span className="text-xs text-muted-foreground">Loading...</span> : null}
      </div>

      {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <div className="space-y-3">
        {providers.map((provider) => {
          const isBusy = Boolean(busy[provider.providerId])
          const isExpanded = Boolean(expanded[provider.providerId])
          const canSave = Boolean(apiKeys[provider.providerId]?.trim())
          const isEnabled = provider.status === 'enabled'

          return (
            <div key={provider.providerId} className="space-y-3 rounded-xl border border-border/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                    {provider.version ? <span className="text-xs text-muted-foreground">v{provider.version}</span> : null}
                    <Badge variant={isEnabled ? 'default' : 'secondary'}>{isEnabled ? 'Enabled' : 'Not set'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {provider.lastUsedAt ? `Last used ${new Date(provider.lastUsedAt).toLocaleString()}` : 'No recorded usage'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => setExpanded((current) => ({ ...current, [provider.providerId]: !isExpanded }))}
                  >
                    {isExpanded ? 'Cancel' : isEnabled ? 'Rotate key' : 'Set key'}
                  </Button>
                  {isEnabled ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => handleDisable(provider.providerId)}
                    >
                      {isBusy ? 'Disabling...' : 'Disable'}
                    </Button>
                  ) : null}
                </div>
              </div>

              {isExpanded ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    value={apiKeys[provider.providerId] ?? ''}
                    onChange={(event) =>
                      setApiKeys((current) => ({ ...current, [provider.providerId]: event.target.value }))
                    }
                    placeholder="Paste API key"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy || !canSave}
                    onClick={() => handleSave(provider.providerId)}
                  >
                    {isBusy ? 'Saving...' : isEnabled ? 'Rotate key' : 'Set key'}
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
