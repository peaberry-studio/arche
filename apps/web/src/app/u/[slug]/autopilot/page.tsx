import { redirect } from 'next/navigation'

import { AutopilotPage } from '@/components/autopilot/autopilot-page'
import { ensureAutopilotSchedulerStarted } from '@/lib/autopilot/scheduler-bootstrap'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { isDesktop } from '@/lib/runtime/mode'

export default async function AutopilotListPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) {
      redirect('/')
    }

    redirect(`/u/${slug}`)
  }

  if (!getRuntimeCapabilities().autopilot) {
    redirect(`/u/${slug}`)
  }

  await ensureAutopilotSchedulerStarted()

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <AutopilotPage slug={slug} />
    </main>
  )
}
