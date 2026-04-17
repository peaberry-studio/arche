'use client'

import { Check, Copy, Plus } from 'lucide-react'
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
import { cn } from '@/lib/utils'

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
const EXPIRATION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
] as const
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
  const [creationOpen, setCreationOpen] = useState(false)
  const [pendingRevokeToken, setPendingRevokeToken] = useState<PersonalAccessTokenItem | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const hasConfigError = Boolean(mcpConfigError)

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

  function handleTokenCreated(tokenRecord: PersonalAccessTokenItem) {
    setTokens((current) => [tokenRecord, ...current])
    setNotice('Token created. Copy it now; it will not be shown again.')
  }

  return (
    <>
      <section className="space-y-5 rounded-lg border border-border/60 bg-card/50 p-6">
        <PanelHeader
          enabled={enabled}
          canManageMcp={canManageMcp}
          hasConfigError={hasConfigError}
          toggling={busyKey === 'toggle'}
          onToggle={handleToggle}
        />

        {mcpConfigError ? (
          <p className="text-sm text-destructive">{mcpConfigError}</p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}

        <PanelBody
          enabled={enabled}
          canManageMcp={canManageMcp}
          hasConfigError={hasConfigError}
          tokens={tokens}
          busyKey={busyKey}
          onCreateClick={() => setCreationOpen(true)}
          onRevoke={handleRequestRevoke}
        />
      </section>

      <CreateTokenDialog
        open={creationOpen}
        onOpenChange={setCreationOpen}
        mcpBaseUrl={mcpBaseUrl}
        onCreated={handleTokenCreated}
      />

      <RevokeTokenDialog
        pendingToken={pendingRevokeToken}
        busy={Boolean(busyKey?.startsWith('revoke:'))}
        onCancel={() => setPendingRevokeToken(null)}
        onConfirm={handleConfirmRevoke}
      />
    </>
  )
}

function PanelHeader({
  enabled,
  canManageMcp,
  hasConfigError,
  toggling,
  onToggle,
}: {
  enabled: boolean
  canManageMcp: boolean
  hasConfigError: boolean
  toggling: boolean
  onToggle: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">MCP access</h2>
        <p className="text-sm text-muted-foreground">
          Connect Claude Code, Codex, Cursor, or any MCP client to your knowledge base, agents, and task prompts.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Badge variant={enabled ? 'success' : 'secondary'}>
          {enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        {canManageMcp ? (
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={hasConfigError || toggling}
          />
        ) : null}
      </div>
    </div>
  )
}

function PanelBody({
  enabled,
  canManageMcp,
  hasConfigError,
  tokens,
  busyKey,
  onCreateClick,
  onRevoke,
}: {
  enabled: boolean
  canManageMcp: boolean
  hasConfigError: boolean
  tokens: PersonalAccessTokenItem[]
  busyKey: string | null
  onCreateClick: () => void
  onRevoke: (token: PersonalAccessTokenItem) => void
}) {
  if (!enabled) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-6 py-10 text-center">
        <p className="text-sm font-medium text-foreground">MCP access is off</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasConfigError
            ? 'Resolve the configuration issue above to continue.'
            : canManageMcp
              ? 'Enable MCP endpoint access before creating tokens.'
              : 'Ask your workspace administrator to enable MCP before generating tokens.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Personal access tokens</p>
        <Button
          size="sm"
          onClick={onCreateClick}
          disabled={hasConfigError}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New token
        </Button>
      </div>

      {tokens.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">No tokens created yet.</p>
          <p className="mt-1 text-sm text-muted-foreground/80">
            Create one to connect Claude Code, Codex, or any MCP client.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60 bg-background/40">
          {tokens.map((token) => (
            <li key={token.id}>
              <TokenRow
                token={token}
                busy={busyKey === `revoke:${token.id}`}
                onRevoke={() => onRevoke(token)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TokenRow({
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
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{token.name}</p>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {token.scopes.map((scope) => (
            <code
              key={scope}
              className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              {scope}
            </code>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Created {formatDate(token.createdAt)} · Expires {formatDate(token.expiresAt)}
        </p>
        <p className="text-xs text-muted-foreground">
          Last used {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : 'Never'}
        </p>
      </div>

      {status.label === 'Active' ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          disabled={busy}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {busy ? 'Revoking...' : 'Revoke'}
        </Button>
      ) : null}
    </div>
  )
}

function CreateTokenDialog({
  open,
  onOpenChange,
  mcpBaseUrl,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mcpBaseUrl: string
  onCreated: (token: PersonalAccessTokenItem) => void
}) {
  const [tokenName, setTokenName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('30')
  const [selectedScopes, setSelectedScopes] = useState<McpScope[]>([...DEFAULT_MCP_PAT_SCOPES])
  const [latestToken, setLatestToken] = useState<LatestToken | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<McpClientPreset>('claude-code')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const createDisabled = submitting || selectedScopes.length === 0

  const setup = useMemo(() => {
    if (!latestToken) return null
    return buildMcpClientSetup(selectedPreset, mcpBaseUrl, latestToken.token)
  }, [latestToken, mcpBaseUrl, selectedPreset])

  function resetForm() {
    setTokenName('')
    setExpiresInDays('30')
    setSelectedScopes([...DEFAULT_MCP_PAT_SCOPES])
    setLatestToken(null)
    setSelectedPreset('claude-code')
    setCopiedKey(null)
    setDialogError('')
  }

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return
    onOpenChange(next)
    if (!next) {
      setTimeout(resetForm, 150)
    }
  }

  function handleScopeToggle(scope: McpScope, checked: boolean) {
    setSelectedScopes((current) => {
      const next = checked
        ? Array.from(new Set([...current, scope]))
        : current.filter((entry) => entry !== scope)

      return next.sort((left, right) => left.localeCompare(right))
    })
  }

  async function handleCreate() {
    setSubmitting(true)
    setDialogError('')

    const result = await createPersonalAccessToken({
      expiresInDays: Number(expiresInDays),
      name: tokenName,
      scopes: selectedScopes,
    })

    setSubmitting(false)
    if (!result.ok) {
      setDialogError(result.error)
      return
    }

    onCreated(result.tokenRecord)
    setLatestToken({
      name: result.tokenRecord.name,
      token: result.token,
      expiresAt: result.tokenRecord.expiresAt,
    })
  }

  async function copyText(text: string, key: string) {
    const copied = await writeTextToClipboard(text)
    if (!copied) {
      setDialogError('Copy failed. Select the text manually if your browser blocks clipboard access.')
      return
    }
    setDialogError('')
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500)
  }

  const inSuccessStep = Boolean(latestToken && setup)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl grid-cols-[minmax(0,1fr)]">
        {inSuccessStep && latestToken && setup ? (
          <>
            <DialogHeader className="min-w-0">
              <DialogTitle>Almost there</DialogTitle>
              <DialogDescription>
                Shown only once — copy it somewhere safe. Expires {formatDate(latestToken.expiresAt)}.
              </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 space-y-4">
              <TokenSecretField
                token={latestToken.token}
                copied={copiedKey === 'secret'}
                onCopy={() => copyText(latestToken.token, 'secret')}
              />

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Quick connect</p>
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

                <p className="text-xs text-muted-foreground">{setup.description}</p>

                <div className="relative min-w-0 overflow-hidden rounded-md border border-border/60 bg-background/60">
                  <pre className="max-w-full whitespace-pre-wrap break-words px-3 py-3 pr-12 text-xs leading-6 text-foreground">
                    <code className="block">{setup.value}</code>
                  </pre>
                  <div className="absolute right-1.5 top-1.5">
                    <CopyIconButton
                      label={setup.mode === 'command' ? 'Copy command' : 'Copy config'}
                      copied={copiedKey === `setup:${setup.preset}`}
                      onClick={() => copyText(setup.value, `setup:${setup.preset}`)}
                    />
                  </div>
                </div>
              </div>

              {dialogError ? (
                <p className="text-sm text-destructive">{dialogError}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="min-w-0">
              <DialogTitle>New MCP token</DialogTitle>
              <DialogDescription>
                Shown once on creation. Scope it to what this client actually needs.
              </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="mcp-token-name">Token name</Label>
                <Input
                  id="mcp-token-name"
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  placeholder="MacBook Pro — Codex"
                />
              </div>

              <div className="space-y-2">
                <Label>Expires in</Label>
                <div className="flex flex-wrap gap-2">
                  {EXPIRATION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setExpiresInDays(option.value)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-sm transition-colors',
                        expiresInDays === option.value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Permissions</Label>
                <div className="space-y-1">
                  {MCP_SCOPE_OPTIONS.map((scope) => {
                    const inputId = `mcp-scope-${scope.value.replace(/[^a-z0-9]+/g, '-')}`
                    return (
                      <label
                        key={scope.value}
                        htmlFor={inputId}
                        className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border border-border"
                          checked={selectedScopes.includes(scope.value)}
                          onChange={(event) => handleScopeToggle(scope.value, event.target.checked)}
                        />
                        <span className="space-y-0.5">
                          <span className="block text-sm font-medium text-foreground">{scope.label}</span>
                          <span className="block text-xs text-muted-foreground">{scope.description}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {dialogError ? (
                <p className="text-sm text-destructive">{dialogError}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createDisabled}>
                {submitting ? 'Creating...' : 'Create token'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TokenSecretField({
  token,
  copied,
  onCopy,
}: {
  token: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border/60 bg-background/60">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{token}</code>
        <CopyIconButton label="Copy token" copied={copied} onClick={onCopy} />
      </div>
    </div>
  )
}

function CopyIconButton({
  label,
  copied,
  onClick,
}: {
  label: string
  copied: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={copied ? 'Copied' : label}
      className="h-8 w-8 shrink-0 p-0"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="h-4 w-4" aria-hidden />
      )}
    </Button>
  )
}

function RevokeTokenDialog({
  pendingToken,
  busy,
  onCancel,
  onConfirm,
}: {
  pendingToken: PersonalAccessTokenItem | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={Boolean(pendingToken)}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md p-0">
        <div className="space-y-6 p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle>Revoke token?</DialogTitle>
            <DialogDescription>
              {pendingToken
                ? `Revoke "${pendingToken.name}"? It will stop working immediately and cannot be recovered.`
                : 'Revoke this token? It will stop working immediately and cannot be recovered.'}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={busy}>
              {busy ? 'Revoking...' : 'Revoke token'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
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

  return copyTextWithEventHandler(text)
}

function copyTextWithEventHandler(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false
  }

  const handleCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/plain', text)
    event.preventDefault()
  }

  document.addEventListener('copy', handleCopy)

  const selection = document.getSelection()
  const previousRanges: Range[] = []
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      previousRanges.push(selection.getRangeAt(index))
    }
  }

  const anchor = document.createElement('span')
  anchor.textContent = '\u00a0'
  anchor.style.position = 'fixed'
  anchor.style.top = '0'
  anchor.style.left = '0'
  anchor.style.opacity = '0'
  anchor.style.pointerEvents = 'none'
  document.body.appendChild(anchor)

  const range = document.createRange()
  range.selectNodeContents(anchor)
  selection?.removeAllRanges()
  selection?.addRange(range)

  let success = false
  try {
    success = document.execCommand('copy')
  } catch {
    success = false
  } finally {
    document.removeEventListener('copy', handleCopy)
    selection?.removeAllRanges()
    previousRanges.forEach((previous) => selection?.addRange(previous))
    anchor.remove()
  }

  return success
}
