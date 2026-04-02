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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

const QUICK_SETUP_PRESETS: McpClientPreset[] = [
  'claude-code',
  'codex',
  'opencode',
  'cursor',
  'generic',
]

export function McpSettingsPanel({
  mcpEnabled,
  mcpConfigError,
  canManageMcp,
  mcpBaseUrl,
  personalAccessTokens,
}: McpSettingsPanelProps) {
  const [enabled, setEnabled] = useState(mcpEnabled)
  const [tokens, setTokens] = useState(personalAccessTokens)
  const [tokenName, setTokenName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('30')
  const [selectedPreset, setSelectedPreset] = useState<McpClientPreset>('claude-code')
  const [latestToken, setLatestToken] = useState<LatestToken | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

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
      name: tokenName,
      expiresInDays: Number(expiresInDays),
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
    setNotice('Token created. Copy it now; it will not be shown again.')
  }

  async function handleRevokeToken(tokenId: string) {
    setBusyKey(`revoke:${tokenId}`)
    setError('')
    setNotice('')

    const result = await revokePersonalAccessToken(tokenId)

    setBusyKey(null)
    if (!result.ok) {
      setError(result.error)
      return
    }

    const revokedAt = new Date().toISOString()
    setTokens((current) =>
      current.map((token) =>
        token.id === tokenId ? { ...token, revokedAt } : token
      )
    )
    setNotice('Token revoked.')
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500)
    } catch {
      setError('Clipboard access is not available in this browser context.')
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">MCP access</h2>
          <p className="text-sm text-muted-foreground">
            Connect Claude Code, Codex, Cursor, OpenCode, or any other MCP client to your published knowledge base.
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
              Personal access tokens are shown once and grant read-only MCP access to your knowledge base.
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
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-token-expiration">Expiration</Label>
              <select
                id="mcp-token-expiration"
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </div>

            <Button onClick={handleCreateToken} disabled={busyKey === 'create'}>
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
                  onRevoke={() => handleRevokeToken(token.id)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {latestToken ? (
        <Card>
          <CardHeader>
            <CardTitle>Quick setup</CardTitle>
            <CardDescription>
              This token for <span className="font-medium text-foreground">{latestToken.name}</span> expires on{' '}
              {formatDate(latestToken.expiresAt)}. Copy it now; Arche will not show it again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Raw token</Label>
              <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-foreground">
                <code>{latestToken.token}</code>
              </pre>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyText(latestToken.token, 'token')}
              >
                {copiedKey === 'token' ? 'Copied' : 'Copy token'}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Client</Label>
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
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Suggested file: <span className="font-medium text-foreground">{setup.filePath}</span>
                </p>
                <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-foreground">
                  <code>{setup.content}</code>
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(setup.content, 'setup')}
                >
                  {copiedKey === 'setup' ? 'Copied' : 'Copy snippet'}
                </Button>
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
  return new Date(value).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
