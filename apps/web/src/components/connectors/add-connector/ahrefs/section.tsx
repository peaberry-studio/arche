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
  buildAhrefsConnectorConfig,
  isAhrefsConnectorConfigurationComplete,
} from './config'

export const AhrefsSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function AhrefsSection({ onStateChange, isActive }, ref) {
  const [apiKey, setApiKey] = useState('')

  useNotifyStateChange(onStateChange, {
    apiKey,
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state = { selectedType: 'ahrefs' as const, apiKey }
      return isAhrefsConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      const state = { selectedType: 'ahrefs' as const, apiKey }
      const configResult = buildAhrefsConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: buildDefaultName('ahrefs'),
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
          {buildDefaultName('ahrefs')}
        </p>
      </div>

      <ManualApiKeyField
        id="connector-ahrefs-api-key"
        placeholder="Paste your Ahrefs API key"
        value={apiKey}
        onChange={setApiKey}
        helperText="Create an API key in your Ahrefs account settings."
      />
    </div>
  )
})
