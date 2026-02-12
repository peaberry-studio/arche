'use client'

import { useEffect, useMemo, useState } from 'react'

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
import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import { cn } from '@/lib/utils'
import { CONNECTOR_TYPES, type ConnectorAuthType, type ConnectorType } from '@/lib/connectors/types'

type AddConnectorModalProps = {
  slug: string
  existingConnectors: Array<{ id: string; type: ConnectorType }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const CONNECTOR_TYPE_OPTIONS: { type: ConnectorType; label: string; description: string }[] = [
  { type: 'linear', label: 'Linear', description: 'Official Linear MCP integration.' },
  { type: 'notion', label: 'Notion', description: 'Official Notion MCP integration.' },
  { type: 'custom', label: 'Custom', description: 'Any compatible remote MCP endpoint.' },
]

const DEFAULT_TYPE: ConnectorType = CONNECTOR_TYPES[0]

function buildDefaultName(type: ConnectorType): string {
  switch (type) {
    case 'linear':
      return 'Linear'
    case 'notion':
      return 'Notion'
    case 'custom':
      return 'Custom Connector'
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const entry of Object.values(value)) {
    if (typeof entry !== 'string') return false
  }
  return true
}

function hasValidHeaders(headersText: string): boolean {
  if (!headersText.trim()) return true
  try {
    const parsed = JSON.parse(headersText) as unknown
    return isStringRecord(parsed)
  } catch {
    return false
  }
}

function supportsOAuth(type: ConnectorType): boolean {
  return type === 'linear' || type === 'notion'
}

export function AddConnectorModal({
  slug,
  existingConnectors,
  open,
  onOpenChange,
  onSaved,
}: AddConnectorModalProps) {
  const { theme } = useWorkspaceTheme()
  const themeClassName = `theme-${theme.id}`
  const darkModeClasses = theme.isDark
    ? `dark dark-${theme.darkVariant}`
    : ''

  const [selectedType, setSelectedType] = useState<ConnectorType>(DEFAULT_TYPE)
  const [authType, setAuthType] = useState<ConnectorAuthType>('oauth')
  const [name, setName] = useState('')

  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [auth, setAuth] = useState('')
  const [headersText, setHeadersText] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOfficialType = selectedType === 'linear' || selectedType === 'notion'

  const availableTypeOptions = useMemo(
    () =>
      CONNECTOR_TYPE_OPTIONS.filter((option) => {
        if (option.type === 'custom') return true
        return !existingConnectors.some((connector) => connector.type === option.type)
      }),
    [existingConnectors]
  )

  function resetState(): void {
    setSelectedType(DEFAULT_TYPE)
    setAuthType('oauth')
    setName('')
    setApiKey('')
    setEndpoint('')
    setAuth('')
    setHeadersText('')
    setIsSaving(false)
    setError(null)
  }

  useEffect(() => {
    if (!open) {
      resetState()
      return
    }

    const defaultType = availableTypeOptions[0]?.type ?? 'custom'
    setSelectedType(defaultType)
    setName(buildDefaultName(defaultType))
  }, [availableTypeOptions, open])

  useEffect(() => {
    if (!open) return
    setName((currentName) => (currentName.trim() ? currentName : buildDefaultName(selectedType)))
  }, [open, selectedType])

  useEffect(() => {
    if (!open) return
    const selectedStillAvailable = availableTypeOptions.some((option) => option.type === selectedType)
    if (!selectedStillAvailable) {
      const fallbackType = availableTypeOptions[0]?.type ?? 'custom'
      setSelectedType(fallbackType)
      setName(buildDefaultName(fallbackType))
    }
  }, [availableTypeOptions, open, selectedType])

  useEffect(() => {
    if (!supportsOAuth(selectedType) && authType !== 'manual') {
      setAuthType('manual')
    }
  }, [authType, selectedType])

  function buildConfig(): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
    if (selectedType === 'linear' || selectedType === 'notion') {
      if (authType === 'oauth') {
        return { ok: true, value: { authType: 'oauth' } }
      }
      if (!apiKey.trim()) {
        return { ok: false, message: 'API key is required.' }
      }
      return { ok: true, value: { authType: 'manual', apiKey: apiKey.trim() } }
    }

    if (selectedType === 'custom') {
      if (!endpoint.trim()) {
        return { ok: false, message: 'Endpoint is required.' }
      }

      if (!headersText.trim()) {
        return {
          ok: true,
          value: {
            authType: 'manual',
            endpoint: endpoint.trim(),
            auth: auth.trim() || undefined,
          },
        }
      }

      try {
        const parsed = JSON.parse(headersText) as unknown
        if (!isStringRecord(parsed)) {
          return { ok: false, message: 'Headers must be a JSON object with string values.' }
        }

        return {
          ok: true,
          value: {
            authType: 'manual',
            endpoint: endpoint.trim(),
            auth: auth.trim() || undefined,
            headers: parsed,
          },
        }
      } catch {
        return { ok: false, message: 'Headers is not valid JSON.' }
      }
    }

    return { ok: false, message: 'Unsupported connector type.' }
  }

  function isConfigurationComplete(): boolean {
    if (selectedType === 'custom' && !name.trim()) return false
    if (selectedType === 'linear' || selectedType === 'notion') {
      return authType === 'oauth' || Boolean(apiKey.trim())
    }
    return Boolean(endpoint.trim() && hasValidHeaders(headersText))
  }

  async function handleSave() {
    const effectiveName = isOfficialType ? buildDefaultName(selectedType) : name.trim()

    if (!effectiveName) {
      setError('Name is required.')
      return
    }

    const configResult = buildConfig()
    if (!configResult.ok) {
      setError(configResult.message)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: selectedType,
          name: effectiveName,
          config: configResult.value,
        }),
      })

      const data = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null

      if (!response.ok) {
        setError(getConnectorErrorMessage(data, 'save_failed'))
        return
      }

      onSaved()
      onOpenChange(false)
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto sm:max-w-xl',
          darkModeClasses,
          themeClassName
        )}
      >
        <DialogHeader>
          <DialogTitle>Add connector</DialogTitle>
          <DialogDescription>
            Choose a type and configure the connection details.
          </DialogDescription>
        </DialogHeader>

        {/* --- Type selector --- */}
        <fieldset className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Type
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {availableTypeOptions.map((option) => {
              const isSelected = option.type === selectedType
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => {
                    setSelectedType(option.type)
                    setError(null)
                  }}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-all',
                    isSelected
                      ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border/50 hover:border-border'
                  )}
                >
                  <p className="text-sm font-medium text-foreground">
                    {option.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </button>
              )
            })}
          </div>
          {availableTypeOptions.length === 1 && availableTypeOptions[0]?.type === 'custom' ? (
            <p className="text-xs text-muted-foreground">
              Linear and Notion are already configured.
            </p>
          ) : null}
        </fieldset>

        {/* --- Divider --- */}
        <hr className="border-border/40" />

        {/* --- Configuration fields --- */}
        <div className="space-y-5">
          {/* Name */}
          {selectedType === 'custom' ? (
            <div className="space-y-2">
              <Label htmlFor="connector-name" className="text-foreground">Name</Label>
              <Input
                id="connector-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Connector name"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-foreground">Name</Label>
              <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground">
                {buildDefaultName(selectedType)}
              </p>
            </div>
          )}

          {/* Auth mode (official types only) */}
          {supportsOAuth(selectedType) ? (
            <div className="space-y-2">
              <Label htmlFor="connector-auth-mode" className="text-foreground">
                Authentication
              </Label>
              <select
                id="connector-auth-mode"
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground"
                value={authType}
                onChange={(event) =>
                  setAuthType(event.target.value === 'oauth' ? 'oauth' : 'manual')
                }
              >
                <option value="oauth">OAuth (official)</option>
                <option value="manual">Manual token / API key</option>
              </select>
            </div>
          ) : null}

          {/* OAuth hint */}
          {(selectedType === 'linear' || selectedType === 'notion') && authType === 'oauth' ? (
            <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Save first, then click <strong className="text-foreground/80">Connect OAuth</strong> from the connector card.
            </p>
          ) : null}

          {/* Manual API key (official types) */}
          {(selectedType === 'linear' || selectedType === 'notion') && authType === 'manual' ? (
            <div className="space-y-2">
              <Label htmlFor="connector-api-key" className="text-foreground">API Key</Label>
              <Input
                id="connector-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Paste your API key"
              />
            </div>
          ) : null}

          {/* Custom connector fields */}
          {selectedType === 'custom' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="connector-endpoint" className="text-foreground">Endpoint</Label>
                <Input
                  id="connector-endpoint"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connector-auth" className="text-foreground">
                  Auth token <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="connector-auth"
                  type="password"
                  value={auth}
                  onChange={(event) => setAuth(event.target.value)}
                  placeholder="Bearer token or API key"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connector-headers" className="text-foreground">
                  Headers <span className="font-normal text-muted-foreground">(optional JSON)</span>
                </Label>
                <textarea
                  id="connector-headers"
                  className="min-h-24 w-full rounded-lg border border-border/50 bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
                  value={headersText}
                  onChange={(event) => setHeadersText(event.target.value)}
                  placeholder={'{\n  "x-api-key": "value"\n}'}
                />
              </div>
            </>
          ) : null}
        </div>

        {/* --- Error --- */}
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {/* --- Footer --- */}
        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isConfigurationComplete()}
          >
            {isSaving ? 'Saving...' : 'Save connector'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
