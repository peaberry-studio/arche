'use client'

import { forwardRef, useImperativeHandle } from 'react'

import {
  type AddConnectorSectionHandle,
  type AddConnectorSectionProps,
  type AddConnectorSubmissionResult,
  useNotifyStateChange,
} from '@/components/connectors/add-connector/section-types'
import { Label } from '@/components/ui/label'
import {
  getGoogleWorkspaceDefaultName,
  type GoogleWorkspaceConnectorType,
} from '@/lib/connectors/google-workspace'

import {
  buildGoogleWorkspaceConnectorConfig,
  isGoogleWorkspaceConnectorConfigurationComplete,
} from './config'

export type GoogleWorkspaceSectionProps = AddConnectorSectionProps & {
  connectorType: GoogleWorkspaceConnectorType
}

export const GoogleWorkspaceSection = forwardRef<
  AddConnectorSectionHandle,
  GoogleWorkspaceSectionProps
>(function GoogleWorkspaceSection({ onStateChange, isActive, connectorType }, ref) {
  useNotifyStateChange(onStateChange, {
    authType: 'oauth',
  })

  useImperativeHandle(ref, () => ({
    isComplete: () => {
      const state = {
        selectedType: connectorType,
        authType: 'oauth' as const,
      }
      return isGoogleWorkspaceConnectorConfigurationComplete(state)
    },
    getSubmission: (): AddConnectorSubmissionResult => {
      const state = {
        selectedType: connectorType,
        authType: 'oauth' as const,
      }
      const configResult = buildGoogleWorkspaceConnectorConfig(state)
      if (!configResult.ok) {
        return { ok: false, message: configResult.message }
      }
      return {
        ok: true,
        name: getGoogleWorkspaceDefaultName(connectorType),
        config: configResult.value,
      }
    },
  }))

  if (!isActive) return null

  const defaultName = getGoogleWorkspaceDefaultName(connectorType)

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-foreground">Name</Label>
        <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground">
          {defaultName}
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-foreground">Authentication</Label>
        <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground">
          OAuth
        </p>
      </div>

      <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Save first, then click{' '}
        <strong className="text-foreground/80">Connect OAuth</strong> from
        the connector card.
      </p>

      <div className="space-y-2 rounded-lg bg-blue-50/50 px-3 py-2 text-xs text-muted-foreground dark:bg-blue-950/20">
        <p className="font-medium text-foreground/80">Google Cloud prerequisites</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Enable the corresponding Workspace API in Google Cloud.</li>
          <li>Enable the corresponding MCP service.</li>
          <li>Configure the OAuth consent screen with the required scopes.</li>
          {connectorType === 'google_chat' ? (
            <li>Configure the Chat app in Google Cloud.</li>
          ) : null}
        </ul>
      </div>
    </div>
  )
})
