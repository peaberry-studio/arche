import Link from 'next/link'
import { redirect } from 'next/navigation'

import { FlowRunHistoryView } from '@/components/flows/flow-run-history-view'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'

export default async function FlowRunsPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>
}) {
  const { id, slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) redirect('/')
    redirect(`/u/${slug}`)
  }

  if (!getRuntimeCapabilities().flows) {
    redirect(`/u/${slug}`)
  }

  return (
    <main className="relative mx-auto max-w-7xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <Link
            href={`/u/${slug}/flows`}
            className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            &larr; Back to flows
          </Link>
        </div>

        <FlowRunHistoryView slug={slug} flowId={id} />
      </div>
    </main>
  )
}
