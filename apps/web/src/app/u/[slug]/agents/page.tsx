import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
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
  if (!token) redirect('/login')

  const session = await getSessionFromToken(token)
  if (!session) redirect('/login')

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/u/${session.user.slug}`)
  }

  const isAdmin = session.user.role === 'ADMIN'

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      <main className="relative mx-auto max-w-6xl px-6 py-12">
        <div className="space-y-8">
          <div>
            <div className="mb-5">
              <Link
                href={`/u/${slug}`}
                className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                &larr; Back to dashboard
              </Link>
            </div>
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
          </div>

          <AgentsPageClient slug={slug} isAdmin={isAdmin} />
        </div>
      </main>
    </div>
  )
}
