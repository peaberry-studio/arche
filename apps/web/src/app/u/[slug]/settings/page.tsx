import { redirect } from 'next/navigation'

import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getDesktopWorkspaceHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { get2FAStatus } from './security/actions'
import { normalizeTwoFactorStatus } from './security/status'
import { SettingsPageContent } from './settings-page-content'
import { getAvailableSettingsSections, resolveSettingsSection } from './sections'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) redirect('/')
    redirect(getDesktopWorkspaceHref('local', 'appearance'))
  }

  const session = await getSession()
  if (!session) redirect('/login')

  const caps = getRuntimeCapabilities()
  const status = caps.twoFactor ? await get2FAStatus() : null
  if (caps.twoFactor && (!status || !status.ok)) redirect('/login')

  const { enabled, verifiedAt, recoveryCodesRemaining } = normalizeTwoFactorStatus(status)
  const availableSections = getAvailableSettingsSections({
    isAdmin: session.user.role === 'ADMIN',
    passwordChangeEnabled: caps.auth,
    slackIntegrationEnabled: caps.slackIntegration,
    twoFactorEnabled: caps.twoFactor,
  })
  const search = await searchParams
  const sectionValue = Array.isArray(search.section) ? search.section[0] : search.section
  const currentSection = resolveSettingsSection(sectionValue, availableSections)
  const releaseVersion =
    process.env.ARCHE_GIT_SHA?.trim() ||
    process.env.ARCHE_RELEASE_VERSION?.trim() ||
    'dev'

  return (
    <SettingsPageContent
      slug={slug}
      availableSections={availableSections}
      currentSection={currentSection}
      passwordChangeEnabled={caps.auth}
      twoFactorEnabled={caps.twoFactor}
      enabled={enabled}
      verifiedAt={verifiedAt}
      recoveryCodesRemaining={recoveryCodesRemaining}
      releaseVersion={releaseVersion}
    />
  )
}
