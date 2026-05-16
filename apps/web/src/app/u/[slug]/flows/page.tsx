import { redirect } from 'next/navigation'

import { FlowsPage } from '@/components/flows/flows-page'
import { ensureFlowSchedulerStarted } from '@/lib/flows/scheduler-bootstrap'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'

export default async function FlowsListPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) redirect('/')
    redirect(`/u/${slug}`)
  }

  if (!getRuntimeCapabilities().flows) {
    redirect(`/u/${slug}`)
  }

  await ensureFlowSchedulerStarted()

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <FlowsPage slug={slug} />
    </main>
  )
}
