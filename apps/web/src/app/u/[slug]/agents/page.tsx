import Link from 'next/link'

import { AgentsPageClient } from '@/components/agents/agents-page'
import { Button } from '@/components/ui/button'
import { getSession } from '@/lib/runtime/session'

export default async function AgentsPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const session = await getSession()
  const isAdmin = session?.user.role === 'ADMIN'

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">
              Agents
            </h1>
            <p className="text-muted-foreground">
              Review shared agents defined in the knowledge base.
            </p>
          </div>
          {isAdmin && (
            <Button variant="outline" asChild>
              <Link href={`/u/${slug}/agents/new`}>Create agent</Link>
            </Button>
          )}
        </div>

        <AgentsPageClient slug={slug} isAdmin={isAdmin} />
      </div>
    </main>
  )
}
