'use client'

import { useCallback, useEffect, useState } from 'react'

import { buildMcpClientConfigs } from '@/lib/mcp/client-config'
import { MCP_SCOPE_AGENTS_READ, MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE } from '@/lib/mcp/scopes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

type McpUserAccess = {
  id: string
  email: string
  slug: string
  role: string
  mcpAllowed: boolean
}

type McpToken = {
  id: string
  name: string
  scopes: string[]
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
  user?: {
    id: string
    email: string
    slug: string
  }
}

type McpSettingsPanelProps = {
  isAdmin: boolean
  slug: string
}

const SCOPE_OPTIONS = [
  { id: MCP_SCOPE_KB_READ, label: 'Read KB' },
  { id: MCP_SCOPE_KB_WRITE, label: 'Write KB' },
  { id: MCP_SCOPE_AGENTS_READ, label: 'Read agents and skills' },
]

export function McpSettingsPanel({ isAdmin, slug }: McpSettingsPanelProps) {
  const [enabled, setEnabled] = useState(false)
  const [mcpAllowed, setMcpAllowed] = useState(false)
  const [users, setUsers] = useState<McpUserAccess[]>([])
  const [tokens, setTokens] = useState<McpToken[]>([])
  const [tokenName, setTokenName] = useState('Arche MCP')
  const [expiresInDays, setExpiresInDays] = useState('30')
  const [scopes, setScopes] = useState<string[]>([MCP_SCOPE_KB_READ])
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const endpoint = typeof window === 'undefined' ? '/api/mcp' : `${window.location.origin}/api/mcp`
  const quickConnectConfigs = createdToken ? buildMcpClientConfigs({ endpoint, token: createdToken }) : []

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [settingsResponse, tokensResponse] = await Promise.all([
        fetch(`/api/u/${slug}/mcp/settings`, { cache: 'no-store' }),
        fetch(`/api/u/${slug}/mcp/tokens`, { cache: 'no-store' }),
      ])
      const settingsData = await settingsResponse.json().catch(() => null) as {
        enabled?: boolean
        mcpAllowed?: boolean
        users?: McpUserAccess[]
        error?: string
      } | null
      const tokensData = await tokensResponse.json().catch(() => null) as { tokens?: McpToken[]; error?: string } | null

      if (!settingsResponse.ok) throw new Error(settingsData?.error ?? 'settings_failed')
      if (!tokensResponse.ok) throw new Error(tokensData?.error ?? 'tokens_failed')

      setEnabled(settingsData?.enabled === true)
      setMcpAllowed(settingsData?.mcpAllowed === true)
      setUsers(settingsData?.users ?? [])
      setTokens(tokensData?.tokens ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/u/${slug}/mcp/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const data = await response.json().catch(() => null) as { enabled?: boolean; users?: McpUserAccess[]; error?: string } | null
      if (!response.ok) throw new Error(data?.error ?? 'update_failed')
      setEnabled(data?.enabled === true)
      setUsers(data?.users ?? [])
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'update_failed')
    } finally {
      setSaving(false)
    }
  }, [slug])

  const updateUserAllowed = useCallback(async (userId: string, nextAllowed: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/u/${slug}/mcp/users/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcpAllowed: nextAllowed }),
      })
      const data = await response.json().catch(() => null) as { user?: McpUserAccess; error?: string } | null
      if (!response.ok || !data?.user) throw new Error(data?.error ?? 'update_failed')
      setUsers((current) => current.map((entry) => (entry.id === data.user?.id ? data.user : entry)))
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'update_failed')
    } finally {
      setSaving(false)
    }
  }, [slug])

  const createToken = useCallback(async () => {
    setSaving(true)
    setError(null)
    setCreatedToken(null)
    try {
      const response = await fetch(`/api/u/${slug}/mcp/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: tokenName, scopes, expiresInDays: Number(expiresInDays) }),
      })
      const data = await response.json().catch(() => null) as { token?: string; record?: McpToken; error?: string } | null
      if (!response.ok || !data?.token || !data.record) throw new Error(data?.error ?? 'create_failed')
      setCreatedToken(data.token)
      setTokens((current) => [data.record as McpToken, ...current])
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'create_failed')
    } finally {
      setSaving(false)
    }
  }, [expiresInDays, scopes, slug, tokenName])

  const revokeToken = useCallback(async (tokenId: string) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/u/${slug}/mcp/tokens/${tokenId}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(data?.error ?? 'revoke_failed')
      setTokens((current) => current.map((token) => (
        token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token
      )))
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'revoke_failed')
    } finally {
      setSaving(false)
    }
  }, [slug])

  if (loading) {
    return <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">Loading MCP settings...</div>
  }

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      {isAdmin ? (
        <Card className="bg-card/50">
          <CardHeader>
            <CardTitle>Global MCP Access</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable public MCP endpoint</p>
              <p className="text-sm text-muted-foreground">When disabled, all PAT-authenticated MCP requests are rejected.</p>
            </div>
            <Switch checked={enabled} disabled={saving} onCheckedChange={updateEnabled} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card className="bg-card/50">
          <CardHeader>
            <CardTitle>User Eligibility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {users.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
                <div>
                  <p className="text-sm font-medium">{entry.email}</p>
                  <p className="text-xs text-muted-foreground">/{entry.slug} - {entry.role}</p>
                </div>
                <Switch checked={entry.mcpAllowed} disabled={saving} onCheckedChange={(checked) => updateUserAllowed(entry.id, checked)} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle>Create Personal Access Token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enabled ? <p className="text-sm text-muted-foreground">MCP is disabled by an admin.</p> : null}
          {enabled && !mcpAllowed ? <p className="text-sm text-muted-foreground">Your user is not allowed to create MCP tokens yet.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={tokenName} disabled={!enabled || !mcpAllowed || saving} onChange={(event) => setTokenName(event.target.value)} placeholder="Token name" />
            <Input value={expiresInDays} disabled={!enabled || !mcpAllowed || saving} onChange={(event) => setExpiresInDays(event.target.value)} inputMode="numeric" placeholder="Expires in days" />
          </div>
          <div className="flex flex-wrap gap-3">
            {SCOPE_OPTIONS.map((scope) => (
              <label key={scope.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={scopes.includes(scope.id)}
                  disabled={!enabled || !mcpAllowed || saving}
                  onChange={(event) => {
                    setScopes((current) => event.target.checked
                      ? Array.from(new Set([...current, scope.id]))
                      : current.filter((entry) => entry !== scope.id))
                  }}
                />
                {scope.label}
              </label>
            ))}
          </div>
          <Button disabled={!enabled || !mcpAllowed || saving || scopes.length === 0} onClick={createToken}>Create token</Button>
        </CardContent>
      </Card>

      {createdToken ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle>Token Shown Once</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea readOnly value={createdToken} className="min-h-20 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs" />
            <div className="grid gap-3 md:grid-cols-2">
              {quickConnectConfigs.map((config) => (
                <div key={config.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <p className="text-sm font-medium">{config.label}</p>
                  <p className="text-xs text-muted-foreground">{config.description}</p>
                  <textarea readOnly value={config.content} className="min-h-36 w-full rounded-md border border-border bg-background p-2 font-mono text-xs" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle>{isAdmin ? 'All MCP Tokens' : 'Your MCP Tokens'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tokens.length === 0 ? <p className="text-sm text-muted-foreground">No MCP tokens yet.</p> : null}
          {tokens.map((token) => (
            <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">{token.name}</p>
                <p className="text-xs text-muted-foreground">Expires {formatDate(token.expiresAt)}{token.user ? ` - ${token.user.email}` : ''}</p>
                <div className="flex flex-wrap gap-1">
                  {token.scopes.map((scope) => <Badge key={scope} variant="secondary">{scope}</Badge>)}
                  {token.revokedAt ? <Badge variant="outline">revoked</Badge> : null}
                </div>
              </div>
              {!token.revokedAt ? <Button variant="outline" disabled={saving} onClick={() => revokeToken(token.id)}>Revoke</Button> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleDateString()
}
