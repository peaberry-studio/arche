import { redirect } from 'next/navigation'

import { DesktopVaultLauncher } from '@/components/desktop/desktop-vault-launcher'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'

export default async function Home() {
  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) {
      return <DesktopVaultLauncher />
    }

    redirect('/w/local')
  }

  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  redirect(`/u/${session.user.slug}`)
}
