import { cookies } from 'next/headers'

import { TeamPageClient } from '@/components/team/team-page-client'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'

export default async function TeamPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? await getSessionFromToken(token) : null

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Team
            </h1>
            <p className="text-muted-foreground">
              Directory of all users in this Arche installation.
            </p>
          </div>
        </div>

        <TeamPageClient
          slug={slug}
          isAdmin={session?.user.role === 'ADMIN'}
          currentUserId={session?.user.id ?? null}
        />
      </div>
    </main>
  )
}
