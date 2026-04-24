'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'

import { ManualApiKeyField } from '@/components/connectors/add-connector/manual-api-key-field'
import { buildDefaultName } from '@/components/connectors/add-connector/shared'
import {
  type AddConnectorSectionHandle,
  type AddConnectorSectionProps,
  type AddConnectorSubmissionResult,
  useNotifyStateChange,
} from '@/components/connectors/add-connector/section-types'
import { Label } from '@/components/ui/label'

import {
  buildNotionConnectorConfig,
  isNotionConnectorConfigurationComplete,
} from './config'

export const NotionSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function NotionSection({ onStateChange, isActive }, ref) {
  const [authType, setAuthType] = useState<'oauth' | 'manual'>('oauth')
  const [apiKey, setApiKey] = useState('')

  useNotifyStateChange(onStateChange, {
    authType,
    apiKey,
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state =
        authType === 'oauth'
          ? { selectedType: 'notion' as const, authType: 'oauth' as const }
          : {
              selectedType: 'notion' as const,
              authType: 'manual' as const,
              apiKey,
            }
      return isNotionConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      const state =
        authType === 'oauth'
          ? { selectedType: 'notion' as const, authType: 'oauth' as const }
          : {
              selectedType: 'notion' as const,
              authType: 'manual' as const,
              apiKey,
            }
      const configResult = buildNotionConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: buildDefaultName('notion'),
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
          {buildDefaultName('notion')}
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
