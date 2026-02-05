import { cookies } from 'next/headers'
import Link from 'next/link'

import { AgentsPageClient } from '@/components/agents/agents-page'
import { Button } from '@/components/ui/button'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'

export default async function AgentsPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? await getSessionFromToken(token) : null
  const isAdmin = session?.user.role === 'ADMIN'

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Agents
            </h1>
            <p className="text-muted-foreground">
              Review shared agents defined in the knowledge base.
            </p>
          </div>
          {isAdmin && (
            <Button asChild>
              <Link href={`/u/${slug}/agents/new`}>Create agent</Link>
            </Button>
          )}
        </div>

        <AgentsPageClient slug={slug} isAdmin={isAdmin} />
      </div>
    </main>
  )
}
