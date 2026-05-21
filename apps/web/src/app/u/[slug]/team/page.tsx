import { redirect } from 'next/navigation'

import { getCurrentDesktopVault, getDesktopWorkspaceHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'

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

  redirect(`/u/${slug}/settings?section=team`)
}
