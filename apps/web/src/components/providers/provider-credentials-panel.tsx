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

export function ProviderCredentialsPanel({
  slug,
  title = 'Provider credentials',
  description = 'Configure API credentials for the current workspace user.',
  showHeader = true,
}: ProviderCredentialsPanelProps) {
  const [providers, setProviders] = useState<TeamProviderStatus[]>([])
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({})
  const [providerBusy, setProviderBusy] = useState<Record<string, boolean>>({})
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({})
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)

  const loadProviders = useCallback(async () => {
    setIsLoadingProviders(true)
    setProviderError(null)

    try {
      const response = await fetch(`/api/u/${slug}/providers`, {
        cache: 'no-store',
      })
      const data = (await response.json().catch(() => null)) as
        | { providers?: TeamProviderStatus[]; error?: string }
        | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'load_failed'))
        return
      }

      setProviders(data?.providers ?? [])
    } catch {
      setProviderError(getTeamErrorMessage('network_error'))
    } finally {
      setIsLoadingProviders(false)
    }
  }, [slug])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  async function handleSaveProvider(providerId: ProviderId) {
    const apiKey = providerApiKeys[providerId]?.trim() ?? ''
    if (!apiKey) return

    setProviderBusy((current) => ({ ...current, [providerId]: true }))
    setProviderError(null)

    try {
      const response = await fetch(`/api/u/${slug}/providers/${providerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        setProviderError(getTeamErrorMessage(data?.error ?? 'provider_update_failed'))
        return
      }

       setProviderApiKeys((current) => ({ ...current, [providerId]: '' }))
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
          const canSave = Boolean(providerApiKeys[provider.providerId]?.trim())
          const isInactive = provider.status === 'missing' || provider.status === 'disabled'

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
                      setProviderApiKeys((current) => ({ ...current, [provider.providerId]: '' }))
                    }}
                  >
                    Cancel
                  </Button>
                </div>
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
                    placeholder="Paste API key"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy || !canSave}
                    onClick={() => handleSaveProvider(provider.providerId)}
                  >
                    {isBusy ? 'Saving...' : 'Set key'}
                  </Button>
                </div>
              </div>
            )
          }

          if (!isExpanded) {
            return (
              <div key={provider.providerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{getProviderLabel(provider.providerId)}</p>
                  {provider.version ? (
                    <span className="text-xs text-muted-foreground">v{provider.version}</span>
                  ) : null}
                  <Badge variant="default">Enabled</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() =>
                      setExpandedProviders((current) => ({ ...current, [provider.providerId]: true }))
                    }
                  >
                    Rotate key
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => handleDisableProvider(provider.providerId)}
                  >
                    {isBusy ? 'Disabling...' : 'Disable'}
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
                  <Badge variant="default">Enabled</Badge>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => {
                    setExpandedProviders((current) => ({ ...current, [provider.providerId]: false }))
                    setProviderApiKeys((current) => ({ ...current, [provider.providerId]: '' }))
                  }}
                >
                  Cancel
                </Button>
              </div>
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
                  placeholder="Paste replacement API key"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy || !canSave}
                  onClick={() => handleSaveProvider(provider.providerId)}
                >
                  {isBusy ? 'Saving...' : 'Rotate key'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
