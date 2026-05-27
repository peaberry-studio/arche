import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/ssr/ClockCounterClockwise'

import { FlowEditor } from '@/components/flows/flow-editor'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getDesktopFlowsHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'

export default async function EditFlowPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>
}) {
  const { id, slug } = await params
  const capabilities = getRuntimeCapabilities()

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) redirect('/')
    redirect(getDesktopFlowsHref('local', 'edit', id))
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
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <h1 className="type-display text-3xl font-semibold tracking-tight">Edit flow</h1>
              <p className="text-muted-foreground">Adjust nodes, routing and schedule for this flow.</p>
            </div>
            <Link
              href={`/u/${slug}/flows/${id}/runs`}
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ClockCounterClockwise size={14} weight="bold" />
              Run history
            </Link>
          </div>
        </div>

        <FlowEditor
          slug={slug}
          mode="edit"
          flowId={id}
          slackIntegrationAvailable={capabilities.slackIntegration}
          teamVisibilityAvailable={capabilities.teamManagement}
        />
      </div>
    </main>
  )
}
