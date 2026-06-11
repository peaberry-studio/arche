import Link from 'next/link'
import { redirect } from 'next/navigation'

import { McpSettingsPanel } from '@/components/mcp/mcp-settings-panel'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { get2FAStatus } from '../../../security/actions'

export default async function McpIntegrationSettingsPage({
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
            <h1 className="type-display text-3xl font-semibold tracking-tight">MCP Access</h1>
            <p className="text-muted-foreground">
              Connect external MCP clients to Arche workspace context with scoped personal access tokens.
            </p>
          </div>
        </div>

        <McpSettingsPanel
          currentUserEmail={session.user.email}
          currentUserId={session.user.id}
          currentUserSlug={session.user.slug}
          isAdmin={session.user.role === 'ADMIN'}
        />
      </div>
    </main>
  )
}
