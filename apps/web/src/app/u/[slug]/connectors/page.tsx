import { redirect } from 'next/navigation'

import { ConnectorsPageClient } from '@/components/connectors/connectors-page-client'
import { getCurrentDesktopVault, getDesktopWorkspaceHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'

export default async function ConnectorsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) {
      redirect('/')
    }

    redirect(getDesktopWorkspaceHref('local', 'connectors'))
  }

  return <ConnectorsPageClient slug={slug} />
}
