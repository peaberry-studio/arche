import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'
import { SlackIntegrationDangerZone } from '@/components/settings/slack-integration-danger-zone'
import { SlackIntegrationPanel } from '@/components/settings/slack-integration-panel'
import { SettingsSection } from '@/components/settings/settings-section'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { SLACK_SERVICE_USER_SLUG } from '@/lib/slack/service-user'
import { get2FAStatus } from '../../security/actions'

export default async function SlackIntegrationSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    redirect(`/u/${slug}/settings?section=integrations`)
  }

  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const caps = getRuntimeCapabilities()
  const status = caps.twoFactor ? await get2FAStatus() : null
  if (caps.twoFactor && (!status || !status.ok)) {
    redirect('/login')
  }

  if (!caps.slackIntegration || session.user.role !== 'ADMIN') {
    redirect(`/u/${slug}/settings?section=integrations`)
  }

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <div className="mb-5">
            <Link
              href={`/u/${slug}/settings?section=integrations`}
              className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              &larr; Back to integrations
            </Link>
          </div>

          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">Slack integration</h1>
            <p className="text-muted-foreground">
              Configure the admin-managed Slack bot, review diagnostics, and manage provider access
              for the reserved service workspace.
            </p>
          </div>
        </div>

        <SlackIntegrationPanel slug={slug} collapsible={false} showDangerZone={false} />

        <SettingsSection
          title="Provider credentials for Slack bot"
          description="Manage API access for the reserved slack-bot service workspace used to generate Slack replies."
        >
          <ProviderCredentialsPanel slug={SLACK_SERVICE_USER_SLUG} showHeader={false} />
        </SettingsSection>

        <SlackIntegrationDangerZone slug={slug} />
      </div>
    </main>
  )
}
