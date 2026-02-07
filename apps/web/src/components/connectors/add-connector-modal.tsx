'use client'

import { useEffect, useState } from 'react'

import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import type { ConnectorDetail, ConnectorTestResult } from '@/components/connectors/types'
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
import { CONNECTOR_TYPES, type ConnectorAuthType, type ConnectorType } from '@/lib/connectors/types'

type AddConnectorModalProps = {
  slug: string
  existingConnectors: Array<{ id: string; type: ConnectorType }>
  open: boolean
  connectorId: string | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

type TestStatus = {
  tone: 'success' | 'error'
  message: string
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

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
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

function formatTestMessage(result: ConnectorTestResult): TestStatus {
  if (result.ok) return { tone: 'success', message: result.message ?? 'Connection verified successfully.' }
  return { tone: 'error', message: result.message ?? 'Connection test failed.' }
}

function supportsOAuth(type: ConnectorType): boolean {
  return type === 'linear' || type === 'notion'
}

export function AddConnectorModal({
  slug,
  existingConnectors,
  open,
  connectorId,
  onOpenChange,
  onSaved,
}: AddConnectorModalProps) {
  const isEditMode = Boolean(connectorId)

  const [selectedType, setSelectedType] = useState<ConnectorType>(DEFAULT_TYPE)
  const [authType, setAuthType] = useState<ConnectorAuthType>('oauth')
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)

  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [auth, setAuth] = useState('')
  const [headersText, setHeadersText] = useState('')

  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<TestStatus | null>(null)

  const isOfficialType = selectedType === 'linear' || selectedType === 'notion'

  const availableTypeOptions = CONNECTOR_TYPE_OPTIONS.filter((option) => {
    if (option.type === 'custom') return true
    if (isEditMode && option.type === selectedType) return true
    return !existingConnectors.some((connector) => connector.type === option.type)
  })

  function resetState(): void {
    setSelectedType(DEFAULT_TYPE)
    setAuthType('oauth')
    setName('')
    setEnabled(true)
    setApiKey('')
    setEndpoint('')
    setAuth('')
    setHeadersText('')
    setIsLoadingDetail(false)
    setIsSaving(false)
    setIsTesting(false)
    setError(null)
    setTestStatus(null)
  }

  useEffect(() => {
    if (!open) {
      resetState()
      return
    }

    if (!connectorId) {
      const defaultType = availableTypeOptions[0]?.type ?? 'custom'
      setSelectedType(defaultType)
      setName(buildDefaultName(defaultType))
      return
    }

    setError(null)
    setTestStatus(null)
    setIsLoadingDetail(true)

    fetch(`/api/u/${slug}/connectors/${connectorId}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | (ConnectorDetail & { error?: string; message?: string })
          | null

        if (!response.ok || !data) {
          setError(getConnectorErrorMessage(data, 'load_failed'))
          return
        }

        setSelectedType(data.type)
        setAuthType(data.authType ?? (supportsOAuth(data.type) ? 'oauth' : 'manual'))
        setName(data.name)
        setEnabled(data.enabled)

        const config = data.config
        if (data.type === 'linear' || data.type === 'notion') {
          setApiKey(getString(config.apiKey))
        }
        if (data.type === 'custom') {
          setEndpoint(getString(config.endpoint))
          setAuth(getString(config.auth))
          if (isStringRecord(config.headers)) {
            setHeadersText(JSON.stringify(config.headers, null, 2))
          }
        }
      })
      .catch(() => {
        setError(getConnectorErrorMessage(null, 'network_error'))
      })
      .finally(() => {
        setIsLoadingDetail(false)
      })
  }, [availableTypeOptions, connectorId, open, slug])

  useEffect(() => {
    if (!open || isEditMode) return
    setName((currentName) => (currentName.trim() ? currentName : buildDefaultName(selectedType)))
  }, [isEditMode, open, selectedType])

  useEffect(() => {
    if (!open || isEditMode) return
    const selectedStillAvailable = availableTypeOptions.some((option) => option.type === selectedType)
    if (!selectedStillAvailable) {
      const fallbackType = availableTypeOptions[0]?.type ?? 'custom'
      setSelectedType(fallbackType)
      setName(buildDefaultName(fallbackType))
    }
  }, [availableTypeOptions, isEditMode, open, selectedType])

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

    const payload = isEditMode
      ? { name: effectiveName, enabled, config: configResult.value }
      : { type: selectedType, name: effectiveName, config: configResult.value }

    try {
      const response = await fetch(
        isEditMode ? `/api/u/${slug}/connectors/${connectorId}` : `/api/u/${slug}/connectors`,
        {
          method: isEditMode ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

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

  async function handleTestConnection() {
    if (!connectorId) {
      setTestStatus({ tone: 'error', message: 'Save the connector before running a connection test.' })
      return
    }

    setIsTesting(true)
    setError(null)
    setTestStatus(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/test`, { method: 'POST' })
      const data = (await response.json().catch(() => null)) as
        | (ConnectorTestResult & { error?: string; message?: string })
        | null

      if (!response.ok || !data) {
        setTestStatus({ tone: 'error', message: getConnectorErrorMessage(data, 'test_failed') })
        return
      }

      setTestStatus(formatTestMessage(data))
    } catch {
      setTestStatus({ tone: 'error', message: getConnectorErrorMessage(null, 'network_error') })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit connector' : 'Add connector'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update this connector configuration.'
              : 'Configure and save in one step without extra screens.'}
          </DialogDescription>
        </DialogHeader>

        {isLoadingDetail ? <p className="text-sm text-muted-foreground">Loading connector...</p> : null}

        {!isLoadingDetail ? (
          <div className="space-y-4">
            {!isEditMode ? (
              <div className="space-y-2">
                <Label>Connector type</Label>
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
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border/60 bg-card/40 hover:border-border'
                        }`}
                      >
                        <p className="font-medium">{option.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                      </button>
                    )
                  })}
                </div>
                {availableTypeOptions.length === 1 && availableTypeOptions[0]?.type === 'custom' ? (
                  <p className="text-xs text-muted-foreground">
                    Linear and Notion are already configured. You can still add Custom connectors.
                  </p>
                ) : null}
              </div>
            ) : null}

            {selectedType === 'custom' ? (
              <div className="space-y-2">
                <Label htmlFor="connector-name">Name</Label>
                <Input
                  id="connector-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Connector name"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Name</Label>
                <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground">
                  {buildDefaultName(selectedType)}
                </p>
              </div>
            )}

            {isEditMode ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Enabled
              </label>
            ) : null}

            {supportsOAuth(selectedType) ? (
              <div className="space-y-2">
                <Label htmlFor="connector-auth-mode">Authentication</Label>
                <select
                  id="connector-auth-mode"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={authType}
                  onChange={(event) => setAuthType(event.target.value === 'oauth' ? 'oauth' : 'manual')}
                >
                  <option value="oauth">OAuth (official)</option>
                  <option value="manual">Manual token/API key</option>
                </select>
              </div>
            ) : null}

            {(selectedType === 'linear' || selectedType === 'notion') && authType === 'oauth' ? (
              <p className="text-xs text-muted-foreground">
                Save first, then click <strong>Connect OAuth</strong> to authenticate from the dashboard.
              </p>
            ) : null}

            {(selectedType === 'linear' || selectedType === 'notion') && authType === 'manual' ? (
              <div className="space-y-2">
                <Label htmlFor="connector-api-key">API Key</Label>
                <Input
                  id="connector-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="token"
                />
              </div>
            ) : null}

            {selectedType === 'custom' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="connector-endpoint">Endpoint</Label>
                  <Input
                    id="connector-endpoint"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="https://example.com/mcp"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="connector-auth">Auth token (optional)</Label>
                  <Input
                    id="connector-auth"
                    type="password"
                    value={auth}
                    onChange={(event) => setAuth(event.target.value)}
                    placeholder="token"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="connector-headers">Headers JSON (optional)</Label>
                  <textarea
                    id="connector-headers"
                    className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                    value={headersText}
                    onChange={(event) => setHeadersText(event.target.value)}
                    placeholder={'{\n  "x-api-key": "value"\n}'}
                  />
                </div>
              </>
            ) : null}

            {testStatus ? (
              <p className={testStatus.tone === 'success' ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
                {testStatus.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {isEditMode ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={isLoadingDetail || isSaving || isTesting}
            >
              {isTesting ? 'Testing...' : 'Test connection'}
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={handleSave}
            disabled={isLoadingDetail || isSaving || isTesting || !isConfigurationComplete()}
          >
            {isSaving ? 'Saving...' : isEditMode ? 'Save changes' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
