'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  buildConnectorConfig,
  buildDefaultName,
  CONNECTOR_TYPE_OPTIONS,
  DEFAULT_LINEAR_OAUTH_ACTOR,
  DEFAULT_TYPE,
  getDefaultAuthType,
  isConnectorConfigurationComplete,
  supportsOAuth,
  type ConnectorFormState,
} from '@/components/connectors/add-connector-config'
import { CustomConnectorFields } from '@/components/connectors/custom-connector-fields'
import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import {
  LinearAppOAuthFields,
  LinearOAuthFields,
} from '@/components/connectors/linear-connector-fields'
import { ManualApiKeyField } from '@/components/connectors/manual-api-key-field'
import { UmamiConnectorFields } from '@/components/connectors/umami-connector-fields'
import { ZendeskConnectorFields } from '@/components/connectors/zendesk-connector-fields'
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
import {
  isLinearOAuthScopeAllowedForActor,
  type LinearOAuthActor,
  type LinearOptionalOAuthScope,
} from '@/lib/connectors/linear'
import {
  isSingleInstanceConnectorType,
  type ConnectorAuthType,
  type ConnectorType,
} from '@/lib/connectors/types'
import { cn } from '@/lib/utils'

type AddConnectorModalProps = {
  slug: string
  existingConnectors: Array<{ id: string; type: ConnectorType }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function AddConnectorModal({
  slug,
  existingConnectors,
  open,
  onOpenChange,
  onSaved,
}: AddConnectorModalProps) {
  const { themeId, isDark } = useWorkspaceTheme()
  const themeClassName = `theme-${themeId}`
  const darkModeClasses = isDark ? 'dark' : ''

  const [selectedType, setSelectedType] = useState<ConnectorType>(DEFAULT_TYPE)
  const [authType, setAuthType] = useState<ConnectorAuthType>(
    getDefaultAuthType(DEFAULT_TYPE)
  )
  const [name, setName] = useState('')

  const [apiKey, setApiKey] = useState('')
  const [zendeskSubdomain, setZendeskSubdomain] = useState('')
  const [zendeskEmail, setZendeskEmail] = useState('')
  const [umamiAuthMethod, setUmamiAuthMethod] = useState<'api-key' | 'login'>(
    'api-key'
  )
  const [umamiBaseUrl, setUmamiBaseUrl] = useState('')
  const [umamiApiKey, setUmamiApiKey] = useState('')
  const [umamiUsername, setUmamiUsername] = useState('')
  const [umamiPassword, setUmamiPassword] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [auth, setAuth] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [oauthScope, setOauthScope] = useState('')
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthAuthorizationEndpoint, setOauthAuthorizationEndpoint] =
    useState('')
  const [oauthTokenEndpoint, setOauthTokenEndpoint] = useState('')
  const [oauthRegistrationEndpoint, setOauthRegistrationEndpoint] =
    useState('')
  const [linearOAuthActor, setLinearOAuthActor] =
    useState<LinearOAuthActor>(DEFAULT_LINEAR_OAUTH_ACTOR)
  const [linearOAuthScopes, setLinearOAuthScopes] = useState<
    LinearOptionalOAuthScope[]
  >([])

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usesGeneratedName = selectedType !== 'custom'

  const availableTypeOptions = useMemo(
    () =>
      CONNECTOR_TYPE_OPTIONS.filter((option) => {
        if (!isSingleInstanceConnectorType(option.type)) return true
        return !existingConnectors.some(
          (connector) => connector.type === option.type
        )
      }),
    [existingConnectors]
  )

  function resetState(): void {
    setSelectedType(DEFAULT_TYPE)
    setAuthType(getDefaultAuthType(DEFAULT_TYPE))
    setName('')
    setApiKey('')
    setZendeskSubdomain('')
    setZendeskEmail('')
    setUmamiAuthMethod('api-key')
    setUmamiBaseUrl('')
    setUmamiApiKey('')
    setUmamiUsername('')
    setUmamiPassword('')
    setEndpoint('')
    setAuth('')
    setHeadersText('')
    setOauthScope('')
    setOauthClientId('')
    setOauthClientSecret('')
    setOauthAuthorizationEndpoint('')
    setOauthTokenEndpoint('')
    setOauthRegistrationEndpoint('')
    setLinearOAuthActor(DEFAULT_LINEAR_OAUTH_ACTOR)
    setLinearOAuthScopes([])
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
    setAuthType(getDefaultAuthType(defaultType))
    setName(buildDefaultName(defaultType))
    setLinearOAuthActor(DEFAULT_LINEAR_OAUTH_ACTOR)
    setLinearOAuthScopes([])
  }, [availableTypeOptions, open])

  useEffect(() => {
    if (!open) return
    setName((currentName) =>
      currentName.trim() ? currentName : buildDefaultName(selectedType)
    )
  }, [open, selectedType])

  useEffect(() => {
    if (!open) return
    const selectedStillAvailable = availableTypeOptions.some(
      (option) => option.type === selectedType
    )
    if (!selectedStillAvailable) {
      const fallbackType = availableTypeOptions[0]?.type ?? 'custom'
      setSelectedType(fallbackType)
      setAuthType(getDefaultAuthType(fallbackType))
      setName(buildDefaultName(fallbackType))
      setLinearOAuthActor(DEFAULT_LINEAR_OAUTH_ACTOR)
      setLinearOAuthScopes([])
    }
  }, [availableTypeOptions, open, selectedType])

  useEffect(() => {
    if (selectedType !== 'linear' || authType !== 'oauth') return

    setLinearOAuthScopes((current) =>
      current.filter((scope) =>
        isLinearOAuthScopeAllowedForActor(scope, linearOAuthActor)
      )
    )
  }, [authType, linearOAuthActor, selectedType])

  const formState: ConnectorFormState = useMemo(
    () => ({
      selectedType,
      authType,
      apiKey,
      zendeskSubdomain,
      zendeskEmail,
      umamiAuthMethod,
      umamiBaseUrl,
      umamiApiKey,
      umamiUsername,
      umamiPassword,
      endpoint,
      auth,
      headersText,
      oauthScope,
      oauthClientId,
      oauthClientSecret,
      oauthAuthorizationEndpoint,
      oauthTokenEndpoint,
      oauthRegistrationEndpoint,
      linearOAuthActor,
      linearOAuthScopes,
    }),
    [
      selectedType,
      authType,
      apiKey,
      zendeskSubdomain,
      zendeskEmail,
      umamiAuthMethod,
      umamiBaseUrl,
      umamiApiKey,
      umamiUsername,
      umamiPassword,
      endpoint,
      auth,
      headersText,
      oauthScope,
      oauthClientId,
      oauthClientSecret,
      oauthAuthorizationEndpoint,
      oauthTokenEndpoint,
      oauthRegistrationEndpoint,
      linearOAuthActor,
      linearOAuthScopes,
    ]
  )

  async function handleSave() {
    const effectiveName = usesGeneratedName
      ? buildDefaultName(selectedType)
      : name.trim()

    if (!effectiveName) {
      setError('Name is required.')
      return
    }

    const configResult = buildConnectorConfig(formState)
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
                    setAuthType(getDefaultAuthType(option.type))
                    setLinearOAuthActor(DEFAULT_LINEAR_OAUTH_ACTOR)
                    setLinearOAuthScopes([])
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
          {availableTypeOptions.length === 1 &&
          availableTypeOptions[0]?.type === 'custom' ? (
            <p className="text-xs text-muted-foreground">
              The single-instance connectors are already configured.
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
              <Label htmlFor="connector-name" className="text-foreground">
                Name
              </Label>
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

          {/* Auth mode */}
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
                  setAuthType(
                    event.target.value === 'oauth' ? 'oauth' : 'manual'
                  )
                }
              >
                <option value="oauth">OAuth</option>
                <option value="manual">Manual token / API key</option>
              </select>
            </div>
          ) : null}

          {selectedType === 'linear' && authType === 'oauth' ? (
            <LinearOAuthFields
              linearOAuthActor={linearOAuthActor}
              onLinearOAuthActorChange={setLinearOAuthActor}
              linearOAuthScopes={linearOAuthScopes}
              onLinearOAuthScopesChange={setLinearOAuthScopes}
            />
          ) : null}

          {/* OAuth hint */}
          {supportsOAuth(selectedType) && authType === 'oauth' ? (
            <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Save first, then click{' '}
              <strong className="text-foreground/80">Connect OAuth</strong> from
              the connector card.
            </p>
          ) : null}

          {selectedType === 'linear' &&
          authType === 'oauth' &&
          linearOAuthActor === 'app' ? (
            <LinearAppOAuthFields
              oauthClientId={oauthClientId}
              onOauthClientIdChange={setOauthClientId}
              oauthClientSecret={oauthClientSecret}
              onOauthClientSecretChange={setOauthClientSecret}
            />
          ) : null}

          {(selectedType === 'linear' || selectedType === 'notion') &&
          authType === 'manual' ? (
            <ManualApiKeyField
              id="connector-api-key"
              value={apiKey}
              onChange={setApiKey}
            />
          ) : null}

          {selectedType === 'ahrefs' ? (
            <ManualApiKeyField
              id="connector-ahrefs-api-key"
              placeholder="Paste your Ahrefs API key"
              value={apiKey}
              onChange={setApiKey}
              helperText="Create an API key in your Ahrefs account settings."
            />
          ) : null}

          {selectedType === 'zendesk' ? (
            <ZendeskConnectorFields
              zendeskSubdomain={zendeskSubdomain}
              onZendeskSubdomainChange={setZendeskSubdomain}
              zendeskEmail={zendeskEmail}
              onZendeskEmailChange={setZendeskEmail}
              apiToken={apiKey}
              onApiTokenChange={setApiKey}
            />
          ) : null}

          {selectedType === 'umami' ? (
            <UmamiConnectorFields
              umamiAuthMethod={umamiAuthMethod}
              onUmamiAuthMethodChange={setUmamiAuthMethod}
              umamiBaseUrl={umamiBaseUrl}
              onUmamiBaseUrlChange={setUmamiBaseUrl}
              umamiApiKey={umamiApiKey}
              onUmamiApiKeyChange={setUmamiApiKey}
              umamiUsername={umamiUsername}
              onUmamiUsernameChange={setUmamiUsername}
              umamiPassword={umamiPassword}
              onUmamiPasswordChange={setUmamiPassword}
            />
          ) : null}

          {selectedType === 'custom' ? (
            <CustomConnectorFields
              authType={authType}
              endpoint={endpoint}
              onEndpointChange={setEndpoint}
              auth={auth}
              onAuthChange={setAuth}
              headersText={headersText}
              onHeadersTextChange={setHeadersText}
              oauthScope={oauthScope}
              onOauthScopeChange={setOauthScope}
              oauthClientId={oauthClientId}
              onOauthClientIdChange={setOauthClientId}
              oauthClientSecret={oauthClientSecret}
              onOauthClientSecretChange={setOauthClientSecret}
              oauthAuthorizationEndpoint={oauthAuthorizationEndpoint}
              onOauthAuthorizationEndpointChange={setOauthAuthorizationEndpoint}
              oauthTokenEndpoint={oauthTokenEndpoint}
              onOauthTokenEndpointChange={setOauthTokenEndpoint}
              oauthRegistrationEndpoint={oauthRegistrationEndpoint}
              onOauthRegistrationEndpointChange={setOauthRegistrationEndpoint}
            />
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
            disabled={isSaving || !isConnectorConfigurationComplete(formState, name)}
          >
            {isSaving ? 'Saving...' : 'Save connector'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
