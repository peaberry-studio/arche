'use client'

import { useEffect, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { ConnectorToolPermissionsSection } from '@/components/connectors/connector-tool-permissions-section'
import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { MetaAdsAdAccount, MetaAdsConnectorPermissions } from '@/lib/connectors/meta-ads-types'

type MetaAdsConnectorSettingsDialogProps = {
  open: boolean
  slug: string
  connectorId: string | null
  connectorName: string | null
  onOpenChange: (open: boolean) => void
}

type MetaAdsSettingsResponse = {
  appId: string
  hasAppSecret: boolean
  permissions: MetaAdsConnectorPermissions
  oauthConnected: boolean
  oauthExpiresAt?: string
  selectedAdAccountIds: string[]
  defaultAdAccountId?: string
  adAccounts: MetaAdsAdAccount[]
  adAccountsError?: string
  redirectUri: string
}

type AccountRowProps = {
  account: MetaAdsAdAccount
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}

function AccountRow({ account, checked, disabled, onCheckedChange }: AccountRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{account.name}</p>
        <p className="text-xs text-muted-foreground">
          {account.id}
          {account.currency ? ` • ${account.currency}` : ''}
          {account.timezoneName ? ` • ${account.timezoneName}` : ''}
        </p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function MetaAdsConnectorSettingsDialog({
  open,
  slug,
  connectorId,
  connectorName,
  onOpenChange,
}: MetaAdsConnectorSettingsDialogProps) {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [permissions, setPermissions] = useState<MetaAdsConnectorPermissions>({
    allowRead: true,
    allowWriteCampaigns: false,
    allowWriteAdSets: false,
    allowWriteAds: false,
  })
  const [oauthConnected, setOauthConnected] = useState(false)
  const [oauthExpiresAt, setOauthExpiresAt] = useState<string | undefined>()
  const [selectedAdAccountIds, setSelectedAdAccountIds] = useState<string[]>([])
  const [defaultAdAccountId, setDefaultAdAccountId] = useState<string>('')
  const [adAccounts, setAdAccounts] = useState<MetaAdsAdAccount[]>([])
  const [adAccountsError, setAdAccountsError] = useState<string | null>(null)
  const [redirectUri, setRedirectUri] = useState('')
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !connectorId) {
      setAppId('')
      setAppSecret('')
      setPermissions({
        allowRead: true,
        allowWriteCampaigns: false,
        allowWriteAdSets: false,
        allowWriteAds: false,
      })
      setOauthConnected(false)
      setOauthExpiresAt(undefined)
      setSelectedAdAccountIds([])
      setDefaultAdAccountId('')
      setAdAccounts([])
      setAdAccountsError(null)
      setRedirectUri('')
      setHasLoadedSettings(false)
      setIsLoading(false)
      setIsSaving(false)
      setError(null)
      return
    }

    let cancelled = false

    async function loadSettings() {
      setHasLoadedSettings(false)
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/meta-ads-settings`, {
          cache: 'no-store',
        })
        const data = (await response.json().catch(() => null)) as
          | (MetaAdsSettingsResponse & { error?: string; message?: string })
          | null

        if (cancelled) return

        if (!response.ok || !data?.appId || !data?.permissions) {
          setError(getConnectorErrorMessage(data, 'load_settings_failed'))
          return
        }

        setAppId(data.appId)
        setAppSecret('')
        setPermissions(data.permissions)
        setOauthConnected(data.oauthConnected)
        setOauthExpiresAt(data.oauthExpiresAt)
        setSelectedAdAccountIds(data.selectedAdAccountIds)
        setDefaultAdAccountId(data.defaultAdAccountId ?? '')
        setAdAccounts(data.adAccounts)
        setAdAccountsError(data.adAccountsError ?? null)
        setRedirectUri(data.redirectUri)
        setHasLoadedSettings(true)
      } catch {
        if (!cancelled) {
          setError(getConnectorErrorMessage(null, 'network_error'))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [connectorId, open, slug])

  function toggleAdAccount(accountId: string, checked: boolean) {
    setSelectedAdAccountIds((current) => {
      const next = checked
        ? current.includes(accountId)
          ? current
          : [...current, accountId]
        : current.filter((entry) => entry !== accountId)

      if (!next.includes(defaultAdAccountId)) {
        setDefaultAdAccountId(next[0] ?? '')
      }

      return next
    })
  }

  async function handleSave() {
    if (!connectorId || !hasLoadedSettings || isLoading || isSaving) {
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/meta-ads-settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appId,
          appSecret,
          permissions,
          selectedAdAccountIds,
          defaultAdAccountId: defaultAdAccountId || null,
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (MetaAdsSettingsResponse & { error?: string; message?: string })
        | null

      if (!response.ok || !data?.appId || !data?.permissions) {
        setError(getConnectorErrorMessage(data, 'save_failed'))
        return
      }

      setAppId(data.appId)
      setAppSecret('')
      setPermissions(data.permissions)
      setOauthConnected(data.oauthConnected)
      setOauthExpiresAt(data.oauthExpiresAt)
      setSelectedAdAccountIds(data.selectedAdAccountIds)
      setDefaultAdAccountId(data.defaultAdAccountId ?? '')
      setAdAccounts(data.adAccounts)
      setAdAccountsError(data.adAccountsError ?? null)
      onOpenChange(false)
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  const selectedAccounts = adAccounts.filter((account) => selectedAdAccountIds.includes(account.id))
  const canEditAccounts = hasLoadedSettings && oauthConnected && !isLoading && !isSaving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Meta Ads settings</DialogTitle>
          <DialogDescription>
            Configure {connectorName ?? 'this connector'} with your Meta app credentials, read permissions and enabled ad accounts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpinnerGap size={16} className="animate-spin" />
              Loading settings...
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <section className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Setup guide</h3>
              <p className="text-xs text-muted-foreground">
                Create a Meta app, enable Facebook Login, add the redirect URI below, request <code>ads_read</code>, then save and connect OAuth from the connector card.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">Redirect URI</Label>
              <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-foreground">
                {redirectUri || 'Loading redirect URI...'}
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Status: {oauthConnected ? 'OAuth connected' : 'OAuth pending'}</span>
              {oauthExpiresAt ? <span>Token expires: {new Date(oauthExpiresAt).toLocaleString()}</span> : null}
            </div>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Meta app credentials</h3>
              <p className="text-xs text-muted-foreground">
                Arche stores these credentials encrypted in the workspace connector so you can reconnect OAuth later without redeploying.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-ads-app-id">App ID</Label>
              <Input
                id="meta-ads-app-id"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                placeholder="Paste your Meta App ID"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-ads-app-secret">App Secret</Label>
              <Input
                id="meta-ads-app-secret"
                type="password"
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                placeholder="Leave blank to keep the current secret"
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Permissions</h3>
              <p className="text-xs text-muted-foreground">
                Arche enforces these permissions before any Meta request is sent. Write permissions are reserved for future iterations.
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-card/40 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Read campaigns and insights</p>
                <p className="text-xs text-muted-foreground">
                  Allow the agent to list ad accounts, campaigns, ad sets, ads and read insights metrics.
                </p>
              </div>
              <Switch
                checked={permissions.allowRead}
                disabled={isLoading || isSaving}
                onCheckedChange={(checked) => setPermissions((current) => ({ ...current, allowRead: checked }))}
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Enabled ad accounts</h3>
              <p className="text-xs text-muted-foreground">
                Only the selected Meta ad accounts will be exposed to the workspace tools.
              </p>
            </div>

            {!oauthConnected ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                Connect OAuth from the connector card before selecting ad accounts.
              </p>
            ) : null}

            {adAccountsError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Could not load ad accounts: {adAccountsError}
              </p>
            ) : null}

            {oauthConnected && !adAccountsError && adAccounts.length === 0 ? (
              <p className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm text-muted-foreground">
                No accessible Meta ad accounts were returned for this OAuth connection.
              </p>
            ) : null}

            <div className="space-y-3">
              {adAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  checked={selectedAdAccountIds.includes(account.id)}
                  disabled={!canEditAccounts}
                  onCheckedChange={(checked) => toggleAdAccount(account.id, checked)}
                />
              ))}
            </div>

            {selectedAccounts.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="meta-ads-default-account">Default ad account</Label>
                <select
                  id="meta-ads-default-account"
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground"
                  disabled={isLoading || isSaving}
                  value={defaultAdAccountId}
                  onChange={(event) => setDefaultAdAccountId(event.target.value)}
                >
                  {selectedAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.id})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>

          <ConnectorToolPermissionsSection connectorId={connectorId} enabled={open && hasLoadedSettings} slug={slug} />

          <div className="flex justify-end gap-2">
            <Button disabled={isSaving} variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={isLoading || isSaving || !connectorId || !hasLoadedSettings || !appId.trim()}
              onClick={() => void handleSave()}
            >
              {isSaving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
