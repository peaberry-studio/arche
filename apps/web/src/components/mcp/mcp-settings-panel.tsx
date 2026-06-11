'use client'

import { useCallback, useEffect, useState } from 'react'

import { buildMcpQuickConnects } from '@/lib/mcp/client-config'
import { MCP_SCOPE_AGENTS_READ, MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE } from '@/lib/mcp/scopes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  isMcpErrorResponse,
  parseMcpAdminSettingsResponse,
  parseMcpCreateTokenResponse,
  parseMcpOkResponse,
  parseMcpTokenListResponse,
  parseMcpUpdateUserAccessResponse,
  parseMcpUserSettingsResponse,
} from '@/lib/mcp/types'
import type {
  McpAdminSettingsResponse,
  McpCreateTokenResponse,
  McpErrorResponse,
  McpOkResponse,
  McpTokenDto,
  McpTokenListResponse,
  McpUpdateUserAccessResponse,
  McpUserAccessDto,
  McpUserSettingsResponse,
} from '@/lib/mcp/types'

type McpSettingsPanelProps = {
  currentUserEmail: string
  currentUserId: string
  currentUserSlug: string
  isAdmin: boolean
}

type TokenListCardProps = {
  emptyMessage: string
  onRevoke: (tokenId: string) => void
  saving: boolean
  title: string
  tokens: McpTokenDto[]
}

const SCOPE_OPTIONS = [
  { id: MCP_SCOPE_KB_READ, label: 'Read KB' },
  { id: MCP_SCOPE_KB_WRITE, label: 'Write KB' },
  { id: MCP_SCOPE_AGENTS_READ, label: 'Read agents and skills' },
]

export function McpSettingsPanel({ currentUserEmail, currentUserId, currentUserSlug, isAdmin }: McpSettingsPanelProps) {
  const [enabled, setEnabled] = useState(false)
  const [mcpAllowed, setMcpAllowed] = useState(false)
  const [adminTokens, setAdminTokens] = useState<McpTokenDto[]>([])
  const [users, setUsers] = useState<McpUserAccessDto[]>([])
  const [tokens, setTokens] = useState<McpTokenDto[]>([])
  const [tokenName, setTokenName] = useState('Arche MCP')
  const [expiresInDays, setExpiresInDays] = useState('30')
  const [scopes, setScopes] = useState<string[]>([MCP_SCOPE_KB_READ])
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const endpoint = typeof window === 'undefined' ? '/api/mcp' : `${window.location.origin}/api/mcp`
  const quickConnects = createdToken ? buildMcpQuickConnects({ endpoint, token: createdToken }) : []

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [settingsResponse, tokensResponse, adminSettingsResponse, adminTokensResponse] = await Promise.all([
        fetch(`/api/u/${currentUserSlug}/mcp/settings`, { cache: 'no-store' }),
        fetch(`/api/u/${currentUserSlug}/mcp/tokens`, { cache: 'no-store' }),
        isAdmin ? fetch('/api/mcp/admin/settings', { cache: 'no-store' }) : Promise.resolve(null),
        isAdmin ? fetch('/api/mcp/admin/tokens', { cache: 'no-store' }) : Promise.resolve(null),
      ])
      const settingsData = await readMcpUserSettingsResponse(settingsResponse)
      const tokensData = await readMcpTokenListResponse(tokensResponse)
      const adminSettingsData = adminSettingsResponse
        ? await readMcpAdminSettingsResponse(adminSettingsResponse)
        : null
      const adminTokensData = adminTokensResponse
        ? await readMcpTokenListResponse(adminTokensResponse)
        : null

      if (!settingsResponse.ok) throw new Error(readMcpError(settingsData, 'settings_failed'))
      if (!tokensResponse.ok) throw new Error(readMcpError(tokensData, 'tokens_failed'))
      if (adminSettingsResponse && !adminSettingsResponse.ok) {
        throw new Error(readMcpError(adminSettingsData, 'admin_settings_failed'))
      }
      if (adminTokensResponse && !adminTokensResponse.ok) {
        throw new Error(readMcpError(adminTokensData, 'admin_tokens_failed'))
      }
      if (!settingsData || isMcpErrorResponse(settingsData)) throw new Error('settings_failed')
      if (!tokensData || isMcpErrorResponse(tokensData)) throw new Error('tokens_failed')
      if (isAdmin && (!adminSettingsData || isMcpErrorResponse(adminSettingsData))) {
        throw new Error('admin_settings_failed')
      }
      if (isAdmin && (!adminTokensData || isMcpErrorResponse(adminTokensData))) throw new Error('admin_tokens_failed')

      setEnabled(settingsData.enabled)
      setMcpAllowed(settingsData.mcpAllowed)
      setUsers(isAdmin && adminSettingsData && !isMcpErrorResponse(adminSettingsData) ? adminSettingsData.users : [])
      setTokens(tokensData.tokens)
      setAdminTokens(isAdmin && adminTokensData && !isMcpErrorResponse(adminTokensData) ? adminTokensData.tokens : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [currentUserSlug, isAdmin])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/mcp/admin/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const data = await readMcpAdminSettingsResponse(response)
      if (!response.ok) throw new Error(readMcpError(data, 'update_failed'))
      if (!data || isMcpErrorResponse(data)) throw new Error('update_failed')
      setEnabled(data.enabled)
      setMcpAllowed(data.mcpAllowed)
      setUsers(data.users)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'update_failed')
    } finally {
      setSaving(false)
    }
  }, [])

  const updateUserAllowed = useCallback(async (userId: string, nextAllowed: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/mcp/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcpAllowed: nextAllowed }),
      })
      const data = await readMcpUpdateUserAccessResponse(response)
      if (!response.ok || !data || isMcpErrorResponse(data)) throw new Error(readMcpError(data, 'update_failed'))
      setUsers((current) => current.map((entry) => (entry.id === data.user.id ? data.user : entry)))
      if (data.user.id === currentUserId) setMcpAllowed(data.user.mcpAllowed)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'update_failed')
    } finally {
      setSaving(false)
    }
  }, [currentUserId])

  const createToken = useCallback(async () => {
    setSaving(true)
    setError(null)
    setCreatedToken(null)
    try {
      const response = await fetch(`/api/u/${currentUserSlug}/mcp/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: tokenName, scopes, expiresInDays: Number(expiresInDays) }),
      })
      const data = await readMcpCreateTokenResponse(response)
      if (!response.ok || !data || isMcpErrorResponse(data)) throw new Error(readMcpError(data, 'create_failed'))
      setCreatedToken(data.token)
      setTokens((current) => [data.record, ...current])
      if (isAdmin) {
        setAdminTokens((current) => [{
          ...data.record,
          user: { id: currentUserId, email: currentUserEmail, slug: currentUserSlug },
        }, ...current])
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'create_failed')
    } finally {
      setSaving(false)
    }
  }, [currentUserEmail, currentUserId, currentUserSlug, expiresInDays, isAdmin, scopes, tokenName])

  const revokePersonalToken = useCallback(async (tokenId: string) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/u/${currentUserSlug}/mcp/tokens/${tokenId}`, { method: 'DELETE' })
      const data = await readMcpOkResponse(response)
      if (!response.ok) throw new Error(readMcpError(data, 'revoke_failed'))
      setTokens((current) => current.map((token) => (
        token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token
      )))
      setAdminTokens((current) => current.map((token) => (
        token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token
      )))
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'revoke_failed')
    } finally {
      setSaving(false)
    }
  }, [currentUserSlug])

  const revokeAdminToken = useCallback(async (tokenId: string) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/mcp/admin/tokens/${tokenId}`, { method: 'DELETE' })
      const data = await readMcpOkResponse(response)
      if (!response.ok) throw new Error(readMcpError(data, 'revoke_failed'))
      setAdminTokens((current) => current.map((token) => (
        token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token
      )))
      setTokens((current) => current.map((token) => (
        token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token
      )))
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'revoke_failed')
    } finally {
      setSaving(false)
    }
  }, [])

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
          <p className="text-sm text-muted-foreground">Tokens created here belong to {currentUserEmail}.</p>
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
            <input readOnly value={createdToken} className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs" />
            <div className="space-y-3">
              {quickConnects.map((entry) => (
                <div key={entry.id} className="space-y-1">
                  <p className="text-sm font-medium">{entry.label}</p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={entry.command} className="flex-1 rounded-md border border-border bg-background p-2 font-mono text-xs" />
                    <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(entry.command)}>Copy</Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <TokenListCard
        emptyMessage="No MCP tokens yet."
        onRevoke={revokePersonalToken}
        saving={saving}
        title="Your MCP Tokens"
        tokens={tokens}
      />

      {isAdmin ? (
        <TokenListCard
          emptyMessage="No MCP tokens exist."
          onRevoke={revokeAdminToken}
          saving={saving}
          title="All MCP Tokens"
          tokens={adminTokens}
        />
      ) : null}
    </div>
  )
}

function TokenListCard({ emptyMessage, onRevoke, saving, title, tokens }: TokenListCardProps) {
  return (
    <Card className="bg-card/50">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tokens.length === 0 ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : null}
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
            {!token.revokedAt ? <Button variant="outline" disabled={saving} onClick={() => onRevoke(token.id)}>Revoke</Button> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleDateString()
}

function readMcpError(data: unknown, fallback: string): string {
  return isMcpErrorResponse(data) ? data.error : fallback
}

async function readMcpUserSettingsResponse(response: Response): Promise<McpUserSettingsResponse | McpErrorResponse | null> {
  const data = await readMcpJsonData(response)
  if (isMcpErrorResponse(data)) return data

  return parseMcpUserSettingsResponse(data)
}

async function readMcpAdminSettingsResponse(response: Response): Promise<McpAdminSettingsResponse | McpErrorResponse | null> {
  const data = await readMcpJsonData(response)
  if (isMcpErrorResponse(data)) return data

  return parseMcpAdminSettingsResponse(data)
}

async function readMcpTokenListResponse(response: Response): Promise<McpTokenListResponse | McpErrorResponse | null> {
  const data = await readMcpJsonData(response)
  if (isMcpErrorResponse(data)) return data

  return parseMcpTokenListResponse(data)
}

async function readMcpCreateTokenResponse(response: Response): Promise<McpCreateTokenResponse | McpErrorResponse | null> {
  const data = await readMcpJsonData(response)
  if (isMcpErrorResponse(data)) return data

  return parseMcpCreateTokenResponse(data)
}

async function readMcpUpdateUserAccessResponse(response: Response): Promise<McpUpdateUserAccessResponse | McpErrorResponse | null> {
  const data = await readMcpJsonData(response)
  if (isMcpErrorResponse(data)) return data

  return parseMcpUpdateUserAccessResponse(data)
}

async function readMcpOkResponse(response: Response): Promise<McpOkResponse | McpErrorResponse | null> {
  const data = await readMcpJsonData(response)
  if (isMcpErrorResponse(data)) return data

  return parseMcpOkResponse(data)
}

async function readMcpJsonData(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}
