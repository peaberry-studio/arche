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
  buildUmamiConnectorConfig,
  isUmamiConnectorConfigurationComplete,
} from './config'
import { UmamiConnectorFields } from './fields'

export const UmamiSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function UmamiSection({ onStateChange, isActive }, ref) {
  const [umamiAuthMethod, setUmamiAuthMethod] = useState<'api-key' | 'login'>(
    'api-key'
  )
  const [umamiBaseUrl, setUmamiBaseUrl] = useState('')
  const [umamiApiKey, setUmamiApiKey] = useState('')
  const [umamiUsername, setUmamiUsername] = useState('')
  const [umamiPassword, setUmamiPassword] = useState('')

  useNotifyStateChange(onStateChange, {
    umamiAuthMethod,
    umamiBaseUrl,
    umamiApiKey,
    umamiUsername,
    umamiPassword,
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state =
        umamiAuthMethod === 'api-key'
          ? {
              selectedType: 'umami' as const,
              umamiAuthMethod: 'api-key' as const,
              umamiBaseUrl,
              umamiApiKey,
            }
          : {
              selectedType: 'umami' as const,
              umamiAuthMethod: 'login' as const,
              umamiBaseUrl,
              umamiUsername,
              umamiPassword,
            }
      return isUmamiConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      const state =
        umamiAuthMethod === 'api-key'
          ? {
              selectedType: 'umami' as const,
              umamiAuthMethod: 'api-key' as const,
              umamiBaseUrl,
              umamiApiKey,
            }
          : {
              selectedType: 'umami' as const,
              umamiAuthMethod: 'login' as const,
              umamiBaseUrl,
              umamiUsername,
              umamiPassword,
            }
      const configResult = buildUmamiConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: buildDefaultName('umami'),
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
          {buildDefaultName('umami')}
        </p>
      </div>

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
    </div>
  )
})
