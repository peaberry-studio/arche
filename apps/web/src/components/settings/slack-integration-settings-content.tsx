'use client'

import { useState } from 'react'

import { ConnectorsManager } from '@/components/connectors/connectors-manager'
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
        <>
          <SettingsSection
            title="Provider credentials for Slack bot"
            description="Manage API access for the reserved slack-bot service workspace used to generate Slack replies."
          >
            <ProviderCredentialsPanel slug={serviceUserSlug} showHeader={false} />
          </SettingsSection>

          <SettingsSection
            title="Connectors for Slack bot"
            description="Create, enable, and test the connectors available to the reserved slack-bot service workspace."
          >
            <ConnectorsManager
              slug={serviceUserSlug}
              embedded
              title="Slack bot connectors"
              description="These connectors are available to the slack-bot service workspace when an agent capability allows them."
              oauthReturnTo={`/u/${slug}/settings/integrations/slack`}
            />
          </SettingsSection>
        </>
      ) : null}

      <SlackIntegrationDangerZone
        slug={slug}
        refreshVersion={refreshVersion}
        onMutated={handleIntegrationMutated}
      />
    </>
  )
}
