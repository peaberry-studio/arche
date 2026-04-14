import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AutopilotTaskForm } from '@/components/autopilot/autopilot-task-form'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { isDesktop } from '@/lib/runtime/mode'

export default async function EditAutopilotPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>
}) {
  const { id, slug } = await params

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

  return (
    <main className="relative mx-auto max-w-4xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <div className="mb-5">
            <Link
              href={`/u/${slug}/autopilot`}
              className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              &larr; Back to autopilot
            </Link>
          </div>
          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">Edit autopilot task</h1>
            <p className="text-muted-foreground">
              Adjust the schedule, prompt and linked run history for this automation.
            </p>
          </div>
        </div>

        <AutopilotTaskForm slug={slug} mode="edit" taskId={id} />
      </div>
    </main>
  )
}
