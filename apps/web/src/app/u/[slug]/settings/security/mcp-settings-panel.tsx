'use client'

import { useMemo, useState } from 'react'

import {
  createPersonalAccessToken,
  revokePersonalAccessToken,
  setMcpEnabled,
} from './actions'
import {
  buildMcpClientSetup,
  type McpClientPreset,
} from './mcp-client-config'
import {
  DEFAULT_MCP_PAT_SCOPES,
  MCP_SCOPE_OPTIONS,
  type McpScope,
} from '@/lib/mcp/scopes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export type PersonalAccessTokenItem = {
  id: string
  name: string
  scopes: string[]
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

type McpSettingsPanelProps = {
  mcpEnabled: boolean
  mcpConfigError: string | null
  canManageMcp: boolean
  mcpBaseUrl: string
  personalAccessTokens: PersonalAccessTokenItem[]
}

type LatestToken = {
  name: string
  token: string
  expiresAt: string
}

const QUICK_SETUP_PRESETS: McpClientPreset[] = ['claude-code', 'codex', 'config']
const LONG_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const
const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export function McpSettingsPanel({
  mcpEnabled,
  mcpConfigError,
  canManageMcp,
  mcpBaseUrl,
  personalAccessTokens,
}: McpSettingsPanelProps) {
  const [enabled, setEnabled] = useState(mcpEnabled)
  const [tokens, setTokens] = useState(() => personalAccessTokens.filter((token) => !token.revokedAt))
  const [tokenName, setTokenName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('30')
  const [selectedScopes, setSelectedScopes] = useState<McpScope[]>([...DEFAULT_MCP_PAT_SCOPES])
  const [selectedPreset, setSelectedPreset] = useState<McpClientPreset>('claude-code')
  const [latestToken, setLatestToken] = useState<LatestToken | null>(null)
  const [pendingRevokeToken, setPendingRevokeToken] = useState<PersonalAccessTokenItem | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const createDisabled = !enabled || Boolean(mcpConfigError) || busyKey === 'create' || selectedScopes.length === 0

  const setup = useMemo(() => {
    if (!latestToken) {
      return null
    }

    return buildMcpClientSetup(selectedPreset, mcpBaseUrl, latestToken.token)
  }, [latestToken, mcpBaseUrl, selectedPreset])

  async function handleToggle(nextEnabled: boolean) {
    const previous = enabled
    setBusyKey('toggle')
    setError('')
    setNotice('')
    setEnabled(nextEnabled)

    const result = await setMcpEnabled(nextEnabled)
    setBusyKey(null)

    if (!result.ok) {
      setEnabled(previous)
      setError(result.error)
      return
    }

    setNotice(nextEnabled ? 'MCP is now enabled.' : 'MCP is now disabled.')
  }

  async function handleCreateToken() {
    setBusyKey('create')
    setError('')
    setNotice('')

    const result = await createPersonalAccessToken({
      expiresInDays: Number(expiresInDays),
      name: tokenName,
      scopes: selectedScopes,
    })

    setBusyKey(null)
    if (!result.ok) {
      setError(result.error)
      return
    }

    setTokens((current) => [result.tokenRecord, ...current])
    setLatestToken({
      name: result.tokenRecord.name,
      token: result.token,
      expiresAt: result.tokenRecord.expiresAt,
    })
    setTokenName('')
    setSelectedScopes([...DEFAULT_MCP_PAT_SCOPES])
    setNotice('Token created. Copy it now; it will not be shown again.')
  }

  function handleRequestRevoke(token: PersonalAccessTokenItem) {
    setPendingRevokeToken(token)
  }

  async function handleConfirmRevoke() {
    const token = pendingRevokeToken
    if (!token) {
      return
    }

    setBusyKey(`revoke:${token.id}`)
    setError('')
    setNotice('')

    const result = await revokePersonalAccessToken(token.id)

    setBusyKey(null)
    if (!result.ok) {
      setError(result.error)
      return
    }

    setTokens((current) => current.filter((entry) => entry.id !== token.id))
    setPendingRevokeToken(null)
    setNotice('Token revoked.')
  }

  async function copyText(text: string, key: string) {
    const copied = await writeTextToClipboard(text)
    if (!copied) {
      setError('Copy failed. Select the text manually if your browser blocks clipboard access.')
      return
    }

    setError('')
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500)
  }

  function handleScopeToggle(scope: McpScope, checked: boolean) {
    setSelectedScopes((current) => {
      const next = checked
        ? Array.from(new Set([...current, scope]))
        : current.filter((entry) => entry !== scope)

      return next.sort((left, right) => left.localeCompare(right))
    })
  }

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">MCP access</h2>
          <p className="text-sm text-muted-foreground">
            Connect Claude Code, Codex, Cursor, OpenCode, or any other MCP client to your knowledge base, agents, and task prompts.
          </p>
        </div>
        <Badge variant={enabled ? 'success' : 'secondary'}>
          {enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Global access</CardTitle>
          <CardDescription>
            Allow external coding agents to authenticate against Arche&apos;s MCP endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Enable MCP endpoint
              </p>
              <p className="text-sm text-muted-foreground">
                {canManageMcp
                  ? 'Administrators can turn access on or off for everyone instantly.'
                  : 'Only administrators can change this setting.'}
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={!canManageMcp || Boolean(mcpConfigError) || busyKey === 'toggle'}
            />
          </div>
          {mcpConfigError ? (
            <p className="text-sm text-destructive">{mcpConfigError}</p>
          ) : null}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Create token</CardTitle>
            <CardDescription>
              Personal access tokens are shown once and can be scoped for knowledge base read/write, agent reads, and task prompts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-token-name">Token name</Label>
              <Input
                id="mcp-token-name"
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
                placeholder="MacBook Pro - Codex"
                disabled={!enabled || Boolean(mcpConfigError)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-token-expiration">Expiration</Label>
              <select
                id="mcp-token-expiration"
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                disabled={!enabled || Boolean(mcpConfigError)}
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </div>

            <div className="space-y-3">
              <Label>MCP permissions</Label>
              <div className="space-y-3 rounded-lg border border-border/60 bg-background/60 p-3">
                {MCP_SCOPE_OPTIONS.map((scope) => {
                  const inputId = `mcp-scope-${scope.value.replace(/[^a-z0-9]+/g, '-')}`

                  return (
                    <label
                      key={scope.value}
                      htmlFor={inputId}
                      className="flex cursor-pointer items-start gap-3 rounded-md"
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border border-border"
                        checked={selectedScopes.includes(scope.value)}
                        onChange={(event) => handleScopeToggle(scope.value, event.target.checked)}
                        disabled={!enabled || Boolean(mcpConfigError)}
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium text-foreground">{scope.label}</span>
                        <span className="block text-sm text-muted-foreground">{scope.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            {!enabled && !mcpConfigError ? (
              <p className="text-sm text-muted-foreground">
                Enable MCP endpoint access before creating tokens.
              </p>
            ) : null}

            <Button onClick={handleCreateToken} disabled={createDisabled}>
              {busyKey === 'create' ? 'Creating...' : 'Create token'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Existing tokens</CardTitle>
            <CardDescription>
              Existing tokens remain hidden after creation. Revoke anything you no longer trust.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tokens created yet.</p>
            ) : (
              tokens.map((token) => (
                <TokenListItem
                  key={token.id}
                  token={token}
                  busy={busyKey === `revoke:${token.id}`}
                  onRevoke={() => handleRequestRevoke(token)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(pendingRevokeToken)}
        onOpenChange={(open) => {
          if (!open && !busyKey?.startsWith('revoke:')) {
            setPendingRevokeToken(null)
          }
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-md p-0">
          <div className="space-y-6 p-6">
            <DialogHeader className="space-y-2">
              <DialogTitle>Revoke token?</DialogTitle>
              <DialogDescription>
                {pendingRevokeToken
                  ? `Revoke "${pendingRevokeToken.name}"? It will stop working immediately and cannot be recovered.`
                  : 'Revoke this token? It will stop working immediately and cannot be recovered.'}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="gap-2 sm:space-x-0">
              <Button
                variant="outline"
                onClick={() => setPendingRevokeToken(null)}
                disabled={Boolean(busyKey?.startsWith('revoke:'))}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmRevoke}
                disabled={Boolean(busyKey?.startsWith('revoke:'))}
              >
                {busyKey?.startsWith('revoke:') ? 'Revoking...' : 'Revoke token'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {latestToken ? (
        <Card>
          <CardHeader>
            <CardTitle>Quick connect</CardTitle>
            <CardDescription>
              Run a single command to connect <span className="font-medium text-foreground">{latestToken.name}</span>.
              This token expires on {formatDate(latestToken.expiresAt)} and will not be shown again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {QUICK_SETUP_PRESETS.map((preset) => {
                  const option = buildMcpClientSetup(preset, mcpBaseUrl, latestToken.token)
                  return (
                    <Button
                      key={preset}
                      variant={selectedPreset === preset ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedPreset(preset)}
                    >
                      {option.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            {setup ? (
              <div className="overflow-hidden rounded-xl border border-border/60 bg-background/60">
                <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{setup.label}</p>
                    <p className="text-sm text-muted-foreground">{setup.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyText(setup.value, `setup:${setup.preset}`)}
                  >
                    {copiedKey === `setup:${setup.preset}`
                      ? 'Copied'
                      : setup.mode === 'command'
                        ? 'Copy command'
                        : 'Copy config'}
                  </Button>
                </div>
                <pre className="overflow-x-auto px-4 py-4 text-xs leading-6 text-foreground">
                  <code>{setup.value}</code>
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}

function TokenListItem({
  token,
  busy,
  onRevoke,
}: {
  token: PersonalAccessTokenItem
  busy: boolean
  onRevoke: () => void
}) {
  const status = getTokenStatus(token)

  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground">{token.name}</p>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Scopes: {token.scopes.join(', ')}
          </p>
          <p className="text-sm text-muted-foreground">
            Created {formatDate(token.createdAt)} · Expires {formatDate(token.expiresAt)}
          </p>
          <p className="text-sm text-muted-foreground">
            Last used {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : 'Never'}
          </p>
        </div>

        {status.label === 'Active' ? (
          <Button variant="outline" size="sm" onClick={onRevoke} disabled={busy}>
            {busy ? 'Revoking...' : 'Revoke'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function getTokenStatus(token: PersonalAccessTokenItem): {
  label: 'Active' | 'Revoked' | 'Expired'
  variant: 'secondary' | 'success' | 'warning'
} {
  if (token.revokedAt) {
    return { label: 'Revoked', variant: 'secondary' }
  }

  if (new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: 'Expired', variant: 'warning' }
  }

  return { label: 'Active', variant: 'success' }
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return `${LONG_MONTH_NAMES[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  const hour = parsed.getUTCHours()
  const minute = String(parsed.getUTCMinutes()).padStart(2, '0')
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12

  return `${SHORT_MONTH_NAMES[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}, ${hour12}:${minute} ${period} UTC`
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to manual copy below.
  }

  return copyTextWithSelection(text)
}

function copyTextWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
