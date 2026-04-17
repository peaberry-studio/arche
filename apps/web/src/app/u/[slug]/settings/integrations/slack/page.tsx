import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SlackIntegrationSettingsContent } from '@/components/settings/slack-integration-settings-content'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { ensureSlackServiceUser, SLACK_SERVICE_USER_SLUG } from '@/lib/slack/service-user'
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

  const serviceUser = await ensureSlackServiceUser()

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

        <SlackIntegrationSettingsContent
          serviceUserSlug={SLACK_SERVICE_USER_SLUG}
          slug={slug}
          showProviderCredentials={serviceUser.ok}
        />
      </div>
    </main>
  )
}
