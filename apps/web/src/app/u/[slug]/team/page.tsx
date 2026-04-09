import { redirect } from 'next/navigation'

import { TeamPageClient } from '@/components/team/team-page-client'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getDesktopWorkspaceHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'

export default async function TeamPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) {
      redirect('/')
    }

    redirect(getDesktopWorkspaceHref('local', 'providers'))
  }

  const session = await getSession()
  const caps = getRuntimeCapabilities()

  return (
    <TeamPageClient
      slug={slug}
      isAdmin={session?.user.role === 'ADMIN'}
      currentUserId={session?.user.id ?? null}
      canManageUsers={caps.teamManagement}
    />
  )
}
