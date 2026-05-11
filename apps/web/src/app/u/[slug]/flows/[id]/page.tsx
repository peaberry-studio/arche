import Link from 'next/link'
import { redirect } from 'next/navigation'

import { FlowEditor } from '@/components/flows/flow-editor'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'

export default async function EditFlowPage({
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
          <div className="mb-5">
            <Link href={`/u/${slug}/flows`} className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground">
              &larr; Back to flows
            </Link>
          </div>
          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">Edit flow</h1>
            <p className="text-muted-foreground">Adjust nodes, routing, schedule and run history for this flow.</p>
          </div>
        </div>

        <FlowEditor slug={slug} mode="edit" flowId={id} />
      </div>
    </main>
  )
}
