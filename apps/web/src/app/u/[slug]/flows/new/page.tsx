import Link from 'next/link'
import { redirect } from 'next/navigation'

import { NewFlowEditor } from '@/components/flows/new-flow-editor'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getDesktopFlowsHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'

export default async function NewFlowPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const capabilities = getRuntimeCapabilities()

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) redirect('/')
    redirect(getDesktopFlowsHref('local', 'new'))
  }

  if (!capabilities.flows) {
    redirect(`/u/${slug}`)
  }

  return (
    <main className="relative mx-auto max-w-7xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <div className="mb-5">
            <Link href={`/u/${slug}/flows`} className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground">
              &larr; Back to flows
            </Link>
          </div>
          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">Create flow</h1>
            <p className="text-muted-foreground">Design a multi-step automation with agents, conditions and human review.</p>
          </div>
        </div>

        <NewFlowEditor
          slug={slug}
          slackIntegrationAvailable={capabilities.slackIntegration}
          teamVisibilityAvailable={capabilities.teamManagement}
        />
      </div>
    </main>
  )
}
