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
  buildMetaAdsConnectorConfig,
  isMetaAdsConnectorConfigurationComplete,
} from './config'

export const MetaAdsSection = forwardRef<
  AddConnectorSectionHandle,
  AddConnectorSectionProps
>(function MetaAdsSection({ onStateChange, isActive }, ref) {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')

  useNotifyStateChange(onStateChange, {
    appId,
    appSecret,
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state = { selectedType: 'meta-ads' as const, appId, appSecret }
      return isMetaAdsConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      const state = { selectedType: 'meta-ads' as const, appId, appSecret }
      const configResult = buildMetaAdsConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: buildDefaultName('meta-ads'),
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
          {buildDefaultName('meta-ads')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="meta-ads-app-id" className="text-foreground">
          App ID
        </Label>
        <Input
          id="meta-ads-app-id"
          placeholder="Paste your Meta App ID"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="meta-ads-app-secret" className="text-foreground">
          App Secret
        </Label>
        <Input
          id="meta-ads-app-secret"
          type="password"
          placeholder="Paste your Meta App Secret"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
        />
      </div>
    </div>
  )
})
