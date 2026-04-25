'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'

import { ManualApiKeyField } from '@/components/connectors/add-connector/manual-api-key-field'
import {
  buildDefaultName,
  DEFAULT_LINEAR_OAUTH_ACTOR,
} from '@/components/connectors/add-connector/shared'
import {
  type AddConnectorSectionHandle,
  type AddConnectorSectionProps,
  type AddConnectorSubmissionResult,
  useNotifyStateChange,
} from '@/components/connectors/add-connector/section-types'
import { Label } from '@/components/ui/label'
import {
  isLinearOAuthScopeAllowedForActor,
  type LinearOAuthActor,
  type LinearOptionalOAuthScope,
} from '@/lib/connectors/linear'

import {
  buildLinearConnectorConfig,
  isLinearConnectorConfigurationComplete,
} from './config'
import { LinearAppOAuthFields, LinearOAuthFields } from './fields'

export const LinearSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function LinearSection({ onStateChange, isActive }, ref) {
  const [authType, setAuthType] = useState<'oauth' | 'manual'>('oauth')
  const [apiKey, setApiKey] = useState('')
  const [linearOAuthActor, setLinearOAuthActor] =
    useState<LinearOAuthActor>(DEFAULT_LINEAR_OAUTH_ACTOR)
  const [linearOAuthScopes, setLinearOAuthScopes] = useState<
    LinearOptionalOAuthScope[]
  >([])
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')

  function pruneScopesForActor(actor: LinearOAuthActor) {
    setLinearOAuthScopes((current) =>
      current.filter((scope) => isLinearOAuthScopeAllowedForActor(scope, actor))
    )
  }

  useNotifyStateChange(onStateChange, {
    authType,
    apiKey,
    linearOAuthActor,
    linearOAuthScopes,
    oauthClientId,
    oauthClientSecret,
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state =
        authType === 'oauth'
          ? {
              selectedType: 'linear' as const,
              authType: 'oauth' as const,
              linearOAuthActor,
              linearOAuthScopes,
              oauthClientId,
              oauthClientSecret,
            }
          : {
              selectedType: 'linear' as const,
              authType: 'manual' as const,
              apiKey,
            }
      return isLinearConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      const state =
        authType === 'oauth'
          ? {
              selectedType: 'linear' as const,
              authType: 'oauth' as const,
              linearOAuthActor,
              linearOAuthScopes,
              oauthClientId,
              oauthClientSecret,
            }
          : {
              selectedType: 'linear' as const,
              authType: 'manual' as const,
              apiKey,
            }
      const configResult = buildLinearConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: buildDefaultName('linear'),
        config: configResult.value,
      }
    },
  }))

  if (!isActive) return null

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-foreground">Name</Label>
        <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground">
          {buildDefaultName('linear')}
        </p>
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
            const next = event.target.value === 'oauth' ? 'oauth' : 'manual'
            setAuthType(next)
            if (next === 'oauth') {
              pruneScopesForActor(linearOAuthActor)
            }
          }}
        >
          <option value="oauth">OAuth</option>
          <option value="manual">Manual token / API key</option>
        </select>
      </div>

      {authType === 'oauth' ? (
        <>
          <LinearOAuthFields
            linearOAuthActor={linearOAuthActor}
            onLinearOAuthActorChange={(actor) => {
              setLinearOAuthActor(actor)
              pruneScopesForActor(actor)
            }}
            linearOAuthScopes={linearOAuthScopes}
            onLinearOAuthScopesChange={setLinearOAuthScopes}
          />
          <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Save first, then click{' '}
            <strong className="text-foreground/80">Connect OAuth</strong> from
            the connector card.
          </p>
          {linearOAuthActor === 'app' ? (
            <LinearAppOAuthFields
              oauthClientId={oauthClientId}
              onOauthClientIdChange={setOauthClientId}
              oauthClientSecret={oauthClientSecret}
              onOauthClientSecretChange={setOauthClientSecret}
            />
          ) : null}
        </>
      ) : null}

      {authType === 'manual' ? (
        <ManualApiKeyField
          id="connector-api-key"
          value={apiKey}
          onChange={setApiKey}
        />
      ) : null}
    </div>
  )
})
