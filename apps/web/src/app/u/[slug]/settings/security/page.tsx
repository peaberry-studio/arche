import { redirect } from 'next/navigation'

import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getDesktopWorkspaceHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { get2FAStatus } from './actions'
import { normalizeTwoFactorStatus } from './status'
import { SettingsPageContent } from './settings-page-content'

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) redirect('/')
    redirect(getDesktopWorkspaceHref('local', 'providers'))
  }

  const session = await getSession()
  if (!session) redirect('/login')

  const caps = getRuntimeCapabilities()
  const status = caps.twoFactor ? await get2FAStatus() : null
  if (caps.twoFactor && (!status || !status.ok)) redirect('/login')

  const { enabled, verifiedAt, recoveryCodesRemaining } = normalizeTwoFactorStatus(status)
  const releaseVersion =
    process.env.ARCHE_GIT_SHA?.trim() ||
    process.env.ARCHE_RELEASE_VERSION?.trim() ||
    'dev'

  return (
    <SettingsPageContent
      slug={slug}
      passwordChangeEnabled={caps.auth}
      twoFactorEnabled={caps.twoFactor}
      enabled={enabled}
      verifiedAt={verifiedAt}
      recoveryCodesRemaining={recoveryCodesRemaining}
      releaseVersion={releaseVersion}
    />
  )
}
