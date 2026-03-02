import { TeamPageClient } from '@/components/team/team-page-client'
import { getAuthenticatedUser } from '@/lib/auth'

export default async function TeamPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const session = await getAuthenticatedUser()

  return (
    <TeamPageClient
      slug={slug}
      isAdmin={session?.user.role === 'ADMIN'}
      currentUserId={session?.user.id ?? null}
    />
  )
}
