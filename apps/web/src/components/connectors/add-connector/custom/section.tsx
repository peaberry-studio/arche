'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'

import { buildDefaultName } from '@/components/connectors/add-connector/shared'
import {
  type AddConnectorSectionHandle,
  type AddConnectorSectionProps,
  type AddConnectorSubmissionResult,
  useNotifyStateChange,
} from '@/components/connectors/add-connector/section-types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  buildCustomConnectorConfig,
  isCustomConnectorConfigurationComplete,
} from './config'
import { CustomConnectorFields } from './fields'

export const CustomSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function CustomSection({ onStateChange, isActive }, ref) {
  const [authType, setAuthType] = useState<'manual' | 'oauth'>('manual')
  const [name, setName] = useState(buildDefaultName('custom'))
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

  useNotifyStateChange(onStateChange, {
    authType,
    name,
    endpoint,
    auth,
    headersText,
    oauthScope,
    oauthClientId,
    oauthClientSecret,
    oauthAuthorizationEndpoint,
    oauthTokenEndpoint,
    oauthRegistrationEndpoint,
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state =
        authType === 'oauth'
          ? {
              selectedType: 'custom' as const,
              authType: 'oauth' as const,
              name,
              endpoint,
              oauthScope,
              oauthClientId,
              oauthClientSecret,
              oauthAuthorizationEndpoint,
              oauthTokenEndpoint,
              oauthRegistrationEndpoint,
            }
          : {
              selectedType: 'custom' as const,
              authType: 'manual' as const,
              name,
              endpoint,
              auth,
              headersText,
            }
      return isCustomConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      if (!name.trim()) {
        return { ok: false, message: 'Name is required.' }
      }
      const state =
        authType === 'oauth'
          ? {
              selectedType: 'custom' as const,
              authType: 'oauth' as const,
              name,
              endpoint,
              oauthScope,
              oauthClientId,
              oauthClientSecret,
              oauthAuthorizationEndpoint,
              oauthTokenEndpoint,
              oauthRegistrationEndpoint,
            }
          : {
              selectedType: 'custom' as const,
              authType: 'manual' as const,
              name,
              endpoint,
              auth,
              headersText,
            }
      const configResult = buildCustomConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: name.trim(),
        config: configResult.value,
      }
    },
  }))

  if (!isActive) return null

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="connector-name" className="text-foreground">
          Name
        </Label>
        <Input
          id="connector-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          placeholder="Connector name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="connector-auth-mode" className="text-foreground">
          Authentication
        </Label>
        <select
          id="connector-auth-mode"
          className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground"
          value={authType}
          onChange={(event) => {
            setAuthType(event.target.value === 'oauth' ? 'oauth' : 'manual')
          }}
        >
          <option value="oauth">OAuth</option>
          <option value="manual">Manual token / API key</option>
        </select>
      </div>

      {authType === 'oauth' ? (
        <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Save first, then click{' '}
          <strong className="text-foreground/80">Connect OAuth</strong> from
          the connector card.
        </p>
      ) : null}

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
    </div>
  )
})
