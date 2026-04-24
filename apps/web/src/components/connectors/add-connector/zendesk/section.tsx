'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'

import { buildDefaultName } from '@/components/connectors/add-connector/shared'
import {
  type AddConnectorSectionHandle,
  type AddConnectorSectionProps,
  type AddConnectorSubmissionResult,
  useNotifyStateChange,
} from '@/components/connectors/add-connector/section-types'
import { Label } from '@/components/ui/label'

import {
  buildZendeskConnectorConfig,
  isZendeskConnectorConfigurationComplete,
} from './config'
import { ZendeskConnectorFields } from './fields'

export const ZendeskSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function ZendeskSection({ onStateChange, isActive }, ref) {
  const [zendeskSubdomain, setZendeskSubdomain] = useState('')
  const [zendeskEmail, setZendeskEmail] = useState('')
  const [apiToken, setApiToken] = useState('')

  useNotifyStateChange(onStateChange, {
    zendeskSubdomain,
    zendeskEmail,
    apiToken,
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state = {
        selectedType: 'zendesk' as const,
        zendeskSubdomain,
        zendeskEmail,
        apiToken,
      }
      return isZendeskConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      const state = {
        selectedType: 'zendesk' as const,
        zendeskSubdomain,
        zendeskEmail,
        apiToken,
      }
      const configResult = buildZendeskConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: buildDefaultName('zendesk'),
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
          {buildDefaultName('zendesk')}
        </p>
      </div>

      <ZendeskConnectorFields
        zendeskSubdomain={zendeskSubdomain}
        onZendeskSubdomainChange={setZendeskSubdomain}
        zendeskEmail={zendeskEmail}
        onZendeskEmailChange={setZendeskEmail}
        apiToken={apiToken}
        onApiTokenChange={setApiToken}
      />
    </div>
  )
})
