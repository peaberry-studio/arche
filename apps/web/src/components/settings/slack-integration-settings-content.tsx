'use client'

import { useState } from 'react'

import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'
import { SettingsSection } from '@/components/settings/settings-section'
import { SlackIntegrationDangerZone } from '@/components/settings/slack-integration-danger-zone'
import { SlackIntegrationPanel } from '@/components/settings/slack-integration-panel'

type SlackIntegrationSettingsContentProps = {
  serviceUserSlug: string
  slug: string
  showProviderCredentials: boolean
}

export function SlackIntegrationSettingsContent({
  serviceUserSlug,
  slug,
  showProviderCredentials,
}: SlackIntegrationSettingsContentProps) {
  const [refreshVersion, setRefreshVersion] = useState(0)

  function handleIntegrationMutated() {
    setRefreshVersion((current) => current + 1)
  }

  return (
    <>
      <SlackIntegrationPanel
        slug={slug}
        collapsible={false}
        showDangerZone={false}
        refreshVersion={refreshVersion}
        onMutated={handleIntegrationMutated}
      />

      {showProviderCredentials ? (
        <SettingsSection
          title="Provider credentials for Slack bot"
          description="Manage API access for the reserved slack-bot service workspace used to generate Slack replies."
        >
          <ProviderCredentialsPanel slug={serviceUserSlug} showHeader={false} />
        </SettingsSection>
      ) : null}

      <SlackIntegrationDangerZone
        slug={slug}
        refreshVersion={refreshVersion}
        onMutated={handleIntegrationMutated}
      />
    </>
  )
}
