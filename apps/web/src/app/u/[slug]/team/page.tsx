import { TeamPageClient } from '@/components/team/team-page-client'
import { getSession } from '@/lib/runtime/session'

export default async function TeamPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const session = await getSession()

  return (
    <TeamPageClient
      slug={slug}
      isAdmin={session?.user.role === 'ADMIN'}
      currentUserId={session?.user.id ?? null}
    />
  )
}
