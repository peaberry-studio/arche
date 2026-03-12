import { redirect } from 'next/navigation'

import { KickstartWizard } from '@/components/kickstart/kickstart-wizard'
import { getSession } from '@/lib/runtime/session'
import { getKickstartStatus } from '@/kickstart/status'

export default async function KickstartPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const { slug } = await params
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/u/${session.user.slug}`)
  }

  if (session.user.role !== 'ADMIN') {
    redirect(`/u/${slug}?setup=admin-required`)
  }

  const status = await getKickstartStatus()
  if (status === 'ready') {
    redirect(`/u/${slug}`)
  }

  return (
    <main className="relative mx-auto w-full max-w-6xl px-6 py-8">
      <section className="mb-6 rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 p-8">
        <p className="mb-2 text-xs uppercase tracking-[0.16em] text-primary/80">Kickstart</p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
          Initial workspace setup
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Configure your company context, select a template, and choose your initial
          agent setup. This setup is applied once and unlocks the workspace.
        </p>
      </section>

      <KickstartWizard slug={slug} initialStatus={status} />
    </main>
  )
}
