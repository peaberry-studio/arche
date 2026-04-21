'use client'

import { useRef, useState } from 'react'

import {
  ConnectorsPanel,
  type ConnectorsPanelHandle,
} from '@/components/connectors/connectors-panel'
import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'
import { SettingsSection } from '@/components/settings/settings-section'
import { SlackIntegrationDangerZone } from '@/components/settings/slack-integration-danger-zone'
import { SlackIntegrationPanel } from '@/components/settings/slack-integration-panel'
import { Button } from '@/components/ui/button'

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
  const connectorsPanelRef = useRef<ConnectorsPanelHandle>(null)

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
            action={
              <Button
                variant="outline"
                onClick={() => connectorsPanelRef.current?.openAddModal()}
              >
                Add connector
              </Button>
            }
          >
            <ConnectorsPanel
              ref={connectorsPanelRef}
              slug={serviceUserSlug}
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
