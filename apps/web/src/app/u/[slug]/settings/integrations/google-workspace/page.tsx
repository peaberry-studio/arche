import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { GoogleWorkspaceIntegrationPanel } from '@/components/settings/google-workspace-integration-panel'
import { getPublicBaseUrl } from '@/lib/http'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { get2FAStatus } from '../../security/actions'

export default async function GoogleWorkspaceIntegrationSettingsPage({
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

  if (!caps.googleWorkspaceIntegration || session.user.role !== 'ADMIN') {
    redirect(`/u/${slug}/settings?section=integrations`)
  }

  const requestHeaders = await headers()
  const publicBaseUrl = getPublicBaseUrl(requestHeaders, 'http://localhost:3000')
  const redirectUri = `${publicBaseUrl}/api/connectors/oauth/callback`

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
            <h1 className="type-display text-3xl font-semibold tracking-tight">Google Workspace integration</h1>
            <p className="text-muted-foreground">
              Configure the admin-managed Google Workspace OAuth client credentials used by all Google connectors.
            </p>
          </div>
        </div>

        <GoogleWorkspaceIntegrationPanel slug={slug} redirectUri={redirectUri} />
      </div>
    </main>
  )
}
